import type { FastifyInstance } from "fastify";
import { z } from "zod";
import { createSupabaseAdminClient, type Database } from "@repo/db";
import { requireChurchScopedAuth, requirePermission } from "../guards.js";
import type { ZodTypeProvider } from "../lib/zod.js";
import { errorZ, memberAlertZ, memberZ, paginationZ } from "../lib/schemas.js";

/**
 * At-risk member alerts (GET /members/alerts). Reads the rows the daily aging job
 * (../jobs/aging-alerts.ts) writes into public.member_alerts and joins each to its
 * member record.
 *
 * `?days=30|60|90` is a floor: days=30 returns everyone at 30+ days inactive
 * (30/60/90 buckets), days=90 only the 90+ bucket. Only open alerts are returned.
 * Requires members.read; church scope is from the JWT. (The underlying table's RLS
 * is staff-only as defence-in-depth; the API authorises via the permission, like
 * the rest of the members module.)
 */

const alertListQueryZ = z.object({
  type: z.literal("inactive").default("inactive"),
  days: z.enum(["30", "60", "90"]).default("30"),
  page: z.coerce.number().int().min(1).default(1),
  pageSize: z.coerce.number().int().min(1).max(100).default(20),
});

const alertEntryZ = z.object({ alert: memberAlertZ, member: memberZ });

export async function membersAlertsRoutes(app: FastifyInstance): Promise<void> {
  const r = app.withTypeProvider<ZodTypeProvider>();

  r.get(
    "/members/alerts",
    {
      onRequest: [app.authenticate, requirePermission("members.read")],
      schema: {
        tags: ["members"],
        summary: "List at-risk member alerts",
        description:
          "Paginated list of open inactivity alerts for the caller's church, each with its member. " +
          "?days=30|60|90 is an inactivity floor (30 includes the 60/90 buckets). Requires members.read.",
        security: [{ bearerAuth: [] }],
        querystring: alertListQueryZ,
        response: {
          200: z.object({ alerts: z.array(alertEntryZ), pagination: paginationZ }),
          400: errorZ,
          401: errorZ,
          403: errorZ,
          500: errorZ,
        },
      },
    },
    async (req, reply) => {
      const auth = requireChurchScopedAuth(req, reply);
      if (!auth) return reply;

      const { days, page, pageSize } = req.query;
      const threshold = Number(days);
      const from = (page - 1) * pageSize;
      const to = from + pageSize - 1;

      const supabase = createSupabaseAdminClient();
      const {
        data: alerts,
        error,
        count,
      } = await supabase
        .from("member_alerts")
        .select("*", { count: "exact" })
        .eq("church_id", auth.churchId)
        .eq("alert_type", "inactive")
        .eq("status", "open")
        .gte("threshold_days", threshold)
        .order("days_inactive", { ascending: false })
        .range(from, to);

      if (error) {
        req.log.error({ err: error }, "alerts list failed");
        return reply.code(500).send({
          error: "ListFailed",
          message: "Could not list alerts. Please try again.",
        });
      }

      const memberIds = (alerts ?? []).map((a) => a.member_id);
      const membersById = new Map<string, Database["public"]["Tables"]["members"]["Row"]>();
      if (memberIds.length > 0) {
        const { data: members } = await supabase
          .from("members")
          .select("*")
          .eq("church_id", auth.churchId)
          .is("deleted_at", null)
          .in("id", memberIds);
        for (const m of members ?? []) membersById.set(m.id, m);
      }

      const entries = (alerts ?? []).flatMap((alert) => {
        const member = membersById.get(alert.member_id);
        return member ? [{ alert, member }] : [];
      });

      const total = count ?? 0;
      const totalPages = total === 0 ? 0 : Math.ceil(total / pageSize);
      return reply.code(200).send({
        alerts: entries,
        pagination: {
          page,
          pageSize,
          total,
          totalPages,
          hasNextPage: page < totalPages,
          hasPrevPage: page > 1,
        },
      });
    },
  );
}
