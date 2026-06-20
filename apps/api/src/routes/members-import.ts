import type { FastifyInstance } from "fastify";
import { z } from "zod";
import { createSupabaseAdminClient, type Database, type Json } from "@repo/db";
import { requireChurchScopedAuth, requirePermission } from "../guards.js";
import type { ZodTypeProvider } from "../lib/zod.js";
import { errorZ } from "../lib/schemas.js";
import { syncMemberToIndex, syncMembersToIndex } from "../lib/meili.js";
import {
  CsvImportError,
  parseMembersCsv,
  type MemberImportRow,
} from "../lib/csv-import.js";

/**
 * Bulk member import from a CSV upload (POST /members/import).
 *
 * Parsing/mapping/validation is the pure {@link parseMembersCsv}; this route owns
 * the database side: duplicate detection (by email or phone, both against the
 * church and within the file) and the writes. New rows go in one atomic bulk
 * insert (the "transaction" — the whole batch commits or rolls back together);
 * existing matches are skipped (default) or updated (?mode=update). ?dryRun=true
 * validates and reports the summary without writing anything, so the UI can preview
 * an import before committing it.
 *
 * Duplicate match: phone is exact; email is case-insensitive against normalised
 * (lowercased) stored emails. Requires members.write; church is from the JWT.
 */

type MemberInsert = Database["public"]["Tables"]["members"]["Insert"];

const importQueryZ = z.object({
  mode: z.enum(["skip", "update"]).default("skip"),
  // Query strings are text; an explicit "true"/"false" beats coercing a boolean.
  dryRun: z.enum(["true", "false"]).default("false"),
});

// row optional: per-field/per-row failures carry a file line; a batch-level
// failure (the atomic insert rolling back) has no single row.
const importErrorZ = z.object({
  row: z.number().int().optional(),
  field: z.string().optional(),
  message: z.string(),
});

const importSkippedRowZ = z.object({ row: z.number().int(), reason: z.string() });

const importSummaryZ = z.object({
  totalRows: z.number().int(),
  added: z.number().int(),
  updated: z.number().int(),
  skipped: z.number().int(),
  failed: z.number().int(),
});

const importResponseZ = z.object({
  dryRun: z.boolean(),
  mode: z.enum(["skip", "update"]),
  summary: importSummaryZ,
  errors: z.array(importErrorZ),
  skippedRows: z.array(importSkippedRowZ),
  ignoredColumns: z.array(z.string()),
  message: z.string(),
});

type ImportError = z.infer<typeof importErrorZ>;

export async function membersImportRoutes(app: FastifyInstance): Promise<void> {
  const r = app.withTypeProvider<ZodTypeProvider>();

  r.post(
    "/members/import",
    {
      onRequest: [app.authenticate, requirePermission("members.write")],
      schema: {
        tags: ["members"],
        summary: "Import members from a CSV file",
        description:
          "Upload a CSV (multipart/form-data) to bulk-create members in the caller's church. " +
          "Validates headers and rows, detects duplicates by email or phone, and returns an " +
          "added/updated/skipped/failed summary with a row-level error list. ?mode=skip|update " +
          "controls duplicate handling; ?dryRun=true validates without writing. Requires members.write.",
        consumes: ["multipart/form-data"],
        security: [{ bearerAuth: [] }],
        querystring: importQueryZ,
        response: {
          200: importResponseZ,
          400: errorZ,
          401: errorZ,
          403: errorZ,
          413: errorZ,
          500: errorZ,
        },
      },
    },
    async (req, reply) => {
      const auth = requireChurchScopedAuth(req, reply);
      if (!auth) return reply;

      const { mode, dryRun: dryRunRaw } = req.query;
      const dryRun = dryRunRaw === "true";

      // Read the uploaded file. req.file() throws if the request isn't multipart;
      // toBuffer() throws if it exceeds the configured size limit.
      let text: string;
      try {
        const file = await req.file();
        if (!file) {
          return reply.code(400).send({
            error: "NoFile",
            message: "Attach a CSV file (multipart/form-data) to import.",
          });
        }
        const buffer = await file.toBuffer();
        text = buffer.toString("utf8");
      } catch (err) {
        const tooLarge = (err as { code?: string }).code === "FST_REQ_FILE_TOO_LARGE";
        return reply.code(tooLarge ? 413 : 400).send({
          error: tooLarge ? "FileTooLarge" : "InvalidUpload",
          message: tooLarge
            ? "The CSV file is too large (max 5 MB)."
            : "Could not read the uploaded file. Send it as multipart/form-data.",
        });
      }

      // Parse + validate. File/header problems are a 400; row problems are collected.
      let parsed;
      try {
        parsed = parseMembersCsv(text);
      } catch (err) {
        if (err instanceof CsvImportError) {
          return reply.code(400).send({ error: "InvalidCsv", message: err.message });
        }
        req.log.error({ err }, "csv parse failed unexpectedly");
        return reply.code(500).send({
          error: "ImportFailed",
          message: "Could not process the CSV file. Please try again.",
        });
      }

      const supabase = createSupabaseAdminClient();

      // Look up existing members that collide on email or phone (one query each).
      const emails = [
        ...new Set(
          parsed.rows.map((row) => row.data.email?.toLowerCase()).filter((v): v is string => !!v),
        ),
      ];
      const phones = [
        ...new Set(parsed.rows.map((row) => row.data.phone).filter((v): v is string => !!v)),
      ];

      const existingByEmail = new Map<string, string>();
      const existingByPhone = new Map<string, string>();
      try {
        if (emails.length > 0) {
          const { data, error } = await supabase
            .from("members")
            .select("id, email")
            .eq("church_id", auth.churchId)
            .is("deleted_at", null)
            .in("email", emails);
          if (error) throw error;
          for (const m of data ?? []) if (m.email) existingByEmail.set(m.email.toLowerCase(), m.id);
        }
        if (phones.length > 0) {
          const { data, error } = await supabase
            .from("members")
            .select("id, phone")
            .eq("church_id", auth.churchId)
            .is("deleted_at", null)
            .in("phone", phones);
          if (error) throw error;
          for (const m of data ?? []) if (m.phone) existingByPhone.set(m.phone, m.id);
        }
      } catch (err) {
        req.log.error({ err }, "import duplicate lookup failed");
        return reply.code(500).send({
          error: "ImportFailed",
          message: "Could not check for existing members. Please try again.",
        });
      }

      // Partition rows into inserts / updates / skips, tracking within-file dupes.
      const seenEmail = new Set<string>();
      const seenPhone = new Set<string>();
      const newInserts: { row: number; insert: MemberInsert }[] = [];
      const pendingUpdates: { row: number; id: string; patch: MemberImportRow }[] = [];
      const skippedRows: { row: number; reason: string }[] = [];

      for (const { row, data } of parsed.rows) {
        const emailKey = data.email?.toLowerCase();
        const phoneKey = data.phone;

        const dupInFile =
          (emailKey !== undefined && seenEmail.has(emailKey)) ||
          (phoneKey !== undefined && seenPhone.has(phoneKey));
        if (emailKey !== undefined) seenEmail.add(emailKey);
        if (phoneKey !== undefined) seenPhone.add(phoneKey);

        if (dupInFile) {
          skippedRows.push({
            row,
            reason: "Duplicate of an earlier row in this file (same email or phone).",
          });
          continue;
        }

        const existingId =
          (emailKey !== undefined ? existingByEmail.get(emailKey) : undefined) ??
          (phoneKey !== undefined ? existingByPhone.get(phoneKey) : undefined);

        if (existingId) {
          if (mode === "update") {
            pendingUpdates.push({ row, id: existingId, patch: data });
          } else {
            skippedRows.push({
              row,
              reason: "A member with this email or phone already exists.",
            });
          }
          continue;
        }

        newInserts.push({ row, insert: { church_id: auth.churchId, ...data } });
      }

      const errors: ImportError[] = [...parsed.errors];
      let failed = parsed.failedRows;
      let added = 0;
      let updated = 0;

      if (dryRun) {
        added = newInserts.length;
        updated = pendingUpdates.length;
      } else {
        // New rows: one atomic bulk insert (all-or-nothing).
        if (newInserts.length > 0) {
          const { data: inserted, error } = await supabase
            .from("members")
            .insert(newInserts.map((n) => n.insert))
            .select("*");

          if (error || !inserted) {
            failed += newInserts.length;
            errors.push({
              message: `Bulk insert failed; no new members were added (${error?.message ?? "unknown error"}).`,
            });
          } else {
            added = inserted.length;
            // Best-effort audit + index; never block or fail the import on these.
            const events = inserted.map((m) => ({
              church_id: auth.churchId,
              member_id: m.id,
              event_type: "note" as const,
              metadata: { action: "imported" } as Json,
              created_by: auth.userId,
            }));
            void supabase
              .from("member_timeline")
              .insert(events)
              .then(({ error: tlErr }) => {
                if (tlErr) req.log.warn({ err: tlErr }, "import timeline append failed");
              });
            void syncMembersToIndex(inserted, req.log);
          }
        }

        // Existing matches in update mode: applied per row (best-effort).
        for (const u of pendingUpdates) {
          const { data: upd, error } = await supabase
            .from("members")
            .update(u.patch)
            .eq("church_id", auth.churchId)
            .eq("id", u.id)
            .is("deleted_at", null)
            .select("*")
            .maybeSingle();
          if (error || !upd) {
            failed++;
            errors.push({
              row: u.row,
              message: `Update failed (${error?.message ?? "no matching active member"}).`,
            });
          } else {
            updated++;
            void syncMemberToIndex(upd, req.log);
          }
        }
      }

      const skipped = skippedRows.length;
      const message = dryRun
        ? `Dry run: ${added} would be added, ${updated} updated, ${skipped} skipped, ${failed} failed. No changes were written.`
        : `Import complete: ${added} added, ${updated} updated, ${skipped} skipped, ${failed} failed.`;

      return reply.code(200).send({
        dryRun,
        mode,
        summary: { totalRows: parsed.totalRows, added, updated, skipped, failed },
        errors,
        skippedRows,
        ignoredColumns: parsed.ignoredColumns,
        message,
      });
    },
  );
}
