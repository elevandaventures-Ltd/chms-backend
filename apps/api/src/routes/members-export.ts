import type { FastifyInstance, FastifyRequest } from "fastify";
import { createSupabaseAdminClient, type Database } from "@repo/db";
import { requireChurchScopedAuth, requirePermission } from "../guards.js";
import { MEMBER_STATUSES } from "../lib/schemas.js";
import { membersToCsv } from "../lib/csv-export.js";
import { membersToPdf } from "../lib/pdf-export.js";

/**
 * Member export (GET /members/export) — streams the filtered directory as a CSV or
 * PDF file. Same filters as GET /members (status / search / includeDeleted), plus
 * an optional `ids` list (used by the bulk export action). `format=csv|pdf`.
 *
 * Registered OUTSIDE the zod module scope (it's a plain JSON-Schema route, like
 * churches/roles) so the zod response serializer never touches the binary payload;
 * the file is sent with an explicit Content-Type and an attachment disposition.
 * Requires members.read; church scope is from the JWT.
 *
 * Note: `ids` rides in the query string, so very large selections can exceed URL
 * limits — for whole-directory exports prefer the filter params over an id list.
 */

const EXPORT_ROW_CAP = 5000;
const UUID_RE = /^[0-9a-fA-F]{8}-[0-9a-fA-F]{4}-[0-9a-fA-F]{4}-[0-9a-fA-F]{4}-[0-9a-fA-F]{12}$/;

interface ExportQuery {
  format?: "csv" | "pdf";
  // Validated against MEMBER_STATUSES by the route's JSON schema before we read it.
  status?: Database["public"]["Enums"]["member_status"];
  search?: string;
  includeDeleted?: "true" | "false";
  ids?: string;
}

// Mirror the members list search sanitiser (strip PostgREST/ilike metacharacters).
function sanitizeSearch(term: string): string {
  return term.replace(/[,()%_\\]/g, " ").trim();
}

export async function membersExportRoutes(app: FastifyInstance): Promise<void> {
  app.get(
    "/members/export",
    {
      onRequest: [app.authenticate, requirePermission("members.read")],
      schema: {
        tags: ["members"],
        summary: "Export members as CSV or PDF",
        description:
          "Streams the filtered church directory as a CSV or PDF file. Same filters as GET /members, " +
          "plus an optional comma-separated `ids` list. Requires members.read.",
        security: [{ bearerAuth: [] }],
        querystring: {
          type: "object",
          properties: {
            format: { type: "string", enum: ["csv", "pdf"], default: "csv" },
            status: { type: "string", enum: [...MEMBER_STATUSES] },
            search: { type: "string" },
            includeDeleted: { type: "string", enum: ["true", "false"], default: "false" },
            ids: { type: "string", description: "Comma-separated member ids to export." },
          },
        },
      },
    },
    async (req: FastifyRequest, reply) => {
      const auth = requireChurchScopedAuth(req, reply);
      if (!auth) return reply;

      const q = req.query as ExportQuery;
      const format = q.format ?? "csv";

      const supabase = createSupabaseAdminClient();
      let query = supabase.from("members").select("*").eq("church_id", auth.churchId);

      if (q.ids) {
        const ids = q.ids
          .split(",")
          .map((s) => s.trim())
          .filter((s) => UUID_RE.test(s))
          .slice(0, EXPORT_ROW_CAP);
        if (ids.length === 0) {
          return reply.code(400).send({ error: "InvalidIds", message: "No valid member ids provided." });
        }
        query = query.in("id", ids);
      } else {
        if (q.includeDeleted !== "true") query = query.is("deleted_at", null);
        if (q.status) query = query.eq("status", q.status);
        if (q.search) {
          const safe = sanitizeSearch(q.search);
          if (safe) {
            const like = `%${safe}%`;
            query = query.or(
              `first_name.ilike.${like},last_name.ilike.${like},preferred_name.ilike.${like},email.ilike.${like}`,
            );
          }
        }
      }

      const { data: members, error } = await query
        .order("created_at", { ascending: false })
        .limit(EXPORT_ROW_CAP);

      if (error) {
        req.log.error({ err: error }, "member export query failed");
        return reply.code(500).send({
          error: "ExportFailed",
          message: "Could not export members. Please try again.",
        });
      }

      const rows = members ?? [];
      const stamp = new Date().toISOString().slice(0, 10);

      if (format === "pdf") {
        const pdf = await membersToPdf(rows);
        return reply
          .code(200)
          .header("Content-Type", "application/pdf")
          .header("Content-Disposition", `attachment; filename="members-${stamp}.pdf"`)
          .send(pdf);
      }

      const csv = membersToCsv(rows);
      return reply
        .code(200)
        .header("Content-Type", "text/csv; charset=utf-8")
        .header("Content-Disposition", `attachment; filename="members-${stamp}.csv"`)
        .send(csv);
    },
  );
}
