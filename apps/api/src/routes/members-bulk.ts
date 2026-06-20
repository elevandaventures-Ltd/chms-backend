import type { FastifyInstance } from "fastify";
import { z } from "zod";
import { createSupabaseAdminClient, type Database, type Json } from "@repo/db";
import { ROLE_PERMISSIONS } from "@repo/api-types";
import { requireChurchScopedAuth, requirePermission } from "../guards.js";
import type { ZodTypeProvider } from "../lib/zod.js";
import { errorZ, memberStatusZ } from "../lib/schemas.js";
import { applyStatusChange, canTransition } from "../lib/member-status.js";

/**
 * Bulk member operations (POST /members/bulk-action) over a set of member ids.
 *
 *   - assign-ministry: add every member to a group (params.groupId); idempotent.
 *     Additionally requires groups.write.
 *   - change-status:   move every member to params.status, gated per member by the
 *     lifecycle state machine (../lib/member-status.ts); disallowed moves are
 *     reported per member.
 *   - archive:         shorthand for change-status to "archived".
 *   - export:          returns a pointer to GET /members/export for the selection
 *     (a JSON summary endpoint shouldn't stream a file).
 *
 * Returns a requested/succeeded/failed summary with a per-member error list. Ids
 * that don't resolve to an active member in the church are counted as failed.
 * Requires members.write; church scope is from the JWT.
 */

const BULK_ACTIONS = ["assign-ministry", "change-status", "export", "archive"] as const;

const bulkActionBodyZ = z.strictObject({
  action: z.enum(BULK_ACTIONS),
  memberIds: z.array(z.uuid()).min(1).max(1000),
  params: z
    .object({
      groupId: z.uuid().optional(),
      status: memberStatusZ.optional(),
      format: z.enum(["csv", "pdf"]).optional(),
    })
    .optional(),
});

const bulkErrorZ = z.object({ memberId: z.string(), message: z.string() });

const bulkResponseZ = z.object({
  action: z.enum(BULK_ACTIONS),
  requested: z.number().int(),
  succeeded: z.number().int(),
  failed: z.number().int(),
  errors: z.array(bulkErrorZ),
  download: z
    .object({ format: z.enum(["csv", "pdf"]), url: z.string(), count: z.number().int() })
    .optional(),
});

export async function membersBulkRoutes(app: FastifyInstance): Promise<void> {
  const r = app.withTypeProvider<ZodTypeProvider>();

  r.post(
    "/members/bulk-action",
    {
      onRequest: [app.authenticate, requirePermission("members.write")],
      schema: {
        tags: ["members"],
        summary: "Run a bulk action over members",
        description:
          "Applies an action (assign-ministry | change-status | archive | export) to a set of member " +
          "ids and returns a per-member summary. assign-ministry also requires groups.write. Requires members.write.",
        security: [{ bearerAuth: [] }],
        body: bulkActionBodyZ,
        response: {
          200: bulkResponseZ,
          400: errorZ,
          401: errorZ,
          403: errorZ,
          404: errorZ,
          500: errorZ,
        },
      },
    },
    async (req, reply) => {
      const auth = requireChurchScopedAuth(req, reply);
      if (!auth) return reply;

      const { action, memberIds, params } = req.body;
      const uniqueIds = [...new Set(memberIds)];
      const supabase = createSupabaseAdminClient();

      // Resolve which requested ids are active members in this church.
      const { data: found, error: fetchErr } = await supabase
        .from("members")
        .select("*")
        .eq("church_id", auth.churchId)
        .is("deleted_at", null)
        .in("id", uniqueIds);

      if (fetchErr) {
        req.log.error({ err: fetchErr }, "bulk-action member lookup failed");
        return reply.code(500).send({
          error: "BulkActionFailed",
          message: "Could not load the selected members. Please try again.",
        });
      }

      const foundById = new Map<string, Database["public"]["Tables"]["members"]["Row"]>(
        (found ?? []).map((m) => [m.id, m]),
      );
      const errors: { memberId: string; message: string }[] = [];
      const present: string[] = [];
      for (const id of uniqueIds) {
        if (foundById.has(id)) present.push(id);
        else errors.push({ memberId: id, message: "No active member with that id in this church." });
      }

      // export: hand back a pointer to the file endpoint (no streaming from here).
      if (action === "export") {
        const format = params?.format ?? "csv";
        const url = `/members/export?ids=${encodeURIComponent(present.join(","))}&format=${format}`;
        return reply.code(200).send({
          action,
          requested: uniqueIds.length,
          succeeded: present.length,
          failed: errors.length,
          errors,
          download: { format, url, count: present.length },
        });
      }

      if (action === "assign-ministry") {
        const groupId = params?.groupId;
        if (!groupId) {
          return reply.code(400).send({
            error: "MissingGroupId",
            message: "params.groupId is required for assign-ministry.",
          });
        }
        const granted = auth.role ? ROLE_PERMISSIONS[auth.role] : [];
        if (!granted.includes("groups.write")) {
          return reply.code(403).send({
            error: "Forbidden",
            message: "Assigning a ministry requires the groups.write permission.",
          });
        }

        const { data: group, error: gErr } = await supabase
          .from("groups")
          .select("id, name")
          .eq("church_id", auth.churchId)
          .eq("id", groupId)
          .maybeSingle();
        if (gErr) {
          req.log.error({ err: gErr }, "bulk assign-ministry group lookup failed");
          return reply.code(500).send({
            error: "BulkActionFailed",
            message: "Could not assign the ministry. Please try again.",
          });
        }
        if (!group) {
          return reply.code(404).send({
            error: "GroupNotFound",
            message: "No group exists with that id in this church.",
          });
        }

        let succeeded = 0;
        if (present.length > 0) {
          const rows = present.map((id) => ({
            group_id: groupId,
            member_id: id,
            church_id: auth.churchId,
            role: null,
            created_by: auth.userId,
          }));
          const { error: upErr } = await supabase
            .from("group_members")
            .upsert(rows, { onConflict: "group_id,member_id", ignoreDuplicates: true });
          if (upErr) {
            req.log.error({ err: upErr }, "bulk assign-ministry upsert failed");
            return reply.code(500).send({
              error: "BulkActionFailed",
              message: "Could not assign the ministry. Please try again.",
            });
          }
          succeeded = present.length;

          // Best-effort group_join events for the member timelines.
          const events = present.map((id) => ({
            church_id: auth.churchId,
            member_id: id,
            event_type: "group_join" as const,
            metadata: { group_id: groupId, group_name: group.name, via: "bulk" } as Json,
            created_by: auth.userId,
          }));
          void supabase
            .from("member_timeline")
            .insert(events)
            .then(({ error: tlErr }) => {
              if (tlErr) req.log.warn({ err: tlErr }, "bulk group_join timeline append failed");
            });
        }

        return reply.code(200).send({
          action,
          requested: uniqueIds.length,
          succeeded,
          failed: errors.length,
          errors,
        });
      }

      // change-status and archive share the lifecycle path.
      const target = action === "archive" ? "archived" : params?.status;
      if (!target) {
        return reply.code(400).send({
          error: "MissingStatus",
          message: "params.status is required for change-status.",
        });
      }

      let succeeded = 0;
      for (const id of present) {
        const member = foundById.get(id);
        if (!member) continue;
        if (member.status === target) {
          succeeded++; // already in the target status — a no-op success.
          continue;
        }
        if (!canTransition(member.status, target)) {
          errors.push({
            memberId: id,
            message: `Cannot change status from "${member.status}" to "${target}".`,
          });
          continue;
        }
        const updated = await applyStatusChange(
          supabase,
          { churchId: auth.churchId, memberId: id, from: member.status, to: target, actorId: auth.userId },
          req.log,
        );
        if (updated) succeeded++;
        else errors.push({ memberId: id, message: "Status change failed." });
      }

      return reply.code(200).send({
        action,
        requested: uniqueIds.length,
        succeeded,
        failed: errors.length,
        errors,
      });
    },
  );
}
