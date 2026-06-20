import type { FastifyInstance } from "fastify";
import { z } from "zod";
import { createSupabaseAdminClient, type Database, type Json } from "@repo/db";
import { requireChurchScopedAuth, requirePermission } from "../guards.js";
import type { ZodTypeProvider } from "../lib/zod.js";
import { logMemberEvent } from "../lib/timeline.js";
import {
  isMeiliConfigured,
  removeMemberFromIndex,
  searchMembers,
  syncMemberToIndex,
} from "../lib/meili.js";
import { allowedNextStatuses, applyStatusChange, canTransition } from "../lib/member-status.js";
import { buildWelcomeMessage, isSmsConfigured, sendSms } from "../lib/sms.js";
import {
  errorZ,
  jsonObjectZ,
  memberGroupSummaryZ,
  memberHouseholdSummaryZ,
  memberStatusZ,
  memberTimelineEventZ,
  memberZ,
  paginationZ,
} from "../lib/schemas.js";

/**
 * Member directory endpoints (the church's people records).
 *
 * Validated with zod (see ../lib/zod.ts for how the zod compilers are scoped so
 * they coexist with the JSON-Schema routes). Reads are church-scoped from the
 * JWT and gated by members.read; writes go through the service_role key after a
 * members.write check, matching the established "mutations via service_role"
 * pattern. Every mutation also appends a member_timeline event (best-effort: the
 * member row is the source of truth, the audit event must never fail the write).
 */

// One Meilisearch hit: a light projection of a member (full profile via :id).
// `status` is a plain string here: it's whatever value the index holds, not a
// schema-validated column.
const memberSearchHitZ = z.object({
  id: z.string(),
  church_id: z.string(),
  first_name: z.string(),
  last_name: z.string().nullable(),
  preferred_name: z.string().nullable(),
  email: z.string().nullable(),
  phone: z.string().nullable(),
  status: z.string(),
});

// POST /members request body. camelCase; mapped to snake_case columns below.
const createMemberBodyZ = z.strictObject({
  firstName: z.string().min(1).max(200),
  lastName: z.string().max(200).optional(),
  preferredName: z.string().max(200).optional(),
  email: z.email().max(320).optional(),
  phone: z.string().max(50).optional(),
  dateOfBirth: z.iso.date().optional(),
  gender: z.string().max(50).optional(),
  maritalStatus: z.string().max(50).optional(),
  photoUrl: z.string().max(2048).optional(),
  addressLine1: z.string().max(300).optional(),
  addressLine2: z.string().max(300).optional(),
  city: z.string().max(120).optional(),
  stateRegion: z.string().max(120).optional(),
  postalCode: z.string().max(40).optional(),
  country: z.string().max(120).optional(),
  geoLat: z.number().min(-90).max(90).optional(),
  geoLng: z.number().min(-180).max(180).optional(),
  neighbourhood: z.string().max(200).optional(),
  baptismDate: z.iso.date().optional(),
  communionDate: z.iso.date().optional(),
  confirmationDate: z.iso.date().optional(),
  ordinationDate: z.iso.date().optional(),
  spiritualMilestones: z.array(z.unknown()).optional(),
  status: memberStatusZ.optional(),
  joinedAt: z.iso.date().optional(),
  notes: z.string().max(10_000).optional(),
  customFields: jsonObjectZ.optional(),
  userId: z.uuid().optional(),
});

type CreateMemberBody = z.infer<typeof createMemberBodyZ>;

// PATCH /members/:id body. Every field optional; nullable ones accept null to
// clear (firstName/status/customFields/spiritualMilestones can't be nulled —
// their columns are NOT NULL). At least one field must be present.
const updateMemberBodyZ = z
  .strictObject({
    firstName: z.string().min(1).max(200).optional(),
    lastName: z.string().max(200).nullish(),
    preferredName: z.string().max(200).nullish(),
    email: z.email().max(320).nullish(),
    phone: z.string().max(50).nullish(),
    dateOfBirth: z.iso.date().nullish(),
    gender: z.string().max(50).nullish(),
    maritalStatus: z.string().max(50).nullish(),
    photoUrl: z.string().max(2048).nullish(),
    addressLine1: z.string().max(300).nullish(),
    addressLine2: z.string().max(300).nullish(),
    city: z.string().max(120).nullish(),
    stateRegion: z.string().max(120).nullish(),
    postalCode: z.string().max(40).nullish(),
    country: z.string().max(120).nullish(),
    geoLat: z.number().min(-90).max(90).nullish(),
    geoLng: z.number().min(-180).max(180).nullish(),
    neighbourhood: z.string().max(200).nullish(),
    baptismDate: z.iso.date().nullish(),
    communionDate: z.iso.date().nullish(),
    confirmationDate: z.iso.date().nullish(),
    ordinationDate: z.iso.date().nullish(),
    spiritualMilestones: z.array(z.unknown()).optional(),
    status: memberStatusZ.optional(),
    joinedAt: z.iso.date().nullish(),
    notes: z.string().max(10_000).nullish(),
    customFields: jsonObjectZ.optional(),
    userId: z.uuid().nullish(),
  })
  .refine((obj) => Object.keys(obj).length > 0, {
    message: "Provide at least one field to update.",
  });

type UpdateMemberBody = z.infer<typeof updateMemberBodyZ>;

// GET /members query. Page/size arrive as strings, so coerce. Lenient on unknown
// params (clients sometimes add cache-busters); the body, by contrast, is strict.
const memberListQueryZ = z.object({
  page: z.coerce.number().int().min(1).default(1),
  pageSize: z.coerce.number().int().min(1).max(100).default(20),
  status: memberStatusZ.optional(),
  search: z.string().trim().min(1).max(200).optional(),
  // Query strings are text, so an explicit "true"/"false" beats coercing a
  // boolean (z.coerce.boolean treats any non-empty string as true).
  includeDeleted: z.enum(["true", "false"]).default("false"),
});

// Standalone flag reused by the single-member read paths.
const includeDeletedQueryZ = z.object({
  includeDeleted: z.enum(["true", "false"]).default("false"),
});

const memberSearchQueryZ = z.object({
  q: z.string().trim().min(1).max(200),
  page: z.coerce.number().int().min(1).default(1),
  pageSize: z.coerce.number().int().min(1).max(100).default(20),
});

const memberIdParamsZ = z.strictObject({ id: z.uuid() });

// POST /members/:id/status — drive the lifecycle state machine (../lib/member-status).
const memberStatusTransitionBodyZ = z.strictObject({
  status: memberStatusZ,
  reason: z.string().max(1000).optional(),
});

/** Cast validated, JSON-shaped data to the DB Json type for inserts. */
function toJson(value: unknown): Json | undefined {
  return value as Json | undefined;
}

/** Map the camelCase create body to a snake_case members Insert row. */
function toMemberInsert(
  body: CreateMemberBody,
  churchId: string,
): Database["public"]["Tables"]["members"]["Insert"] {
  return {
    church_id: churchId,
    user_id: body.userId,
    first_name: body.firstName,
    last_name: body.lastName,
    preferred_name: body.preferredName,
    email: body.email,
    phone: body.phone,
    date_of_birth: body.dateOfBirth,
    gender: body.gender,
    marital_status: body.maritalStatus,
    photo_url: body.photoUrl,
    address_line1: body.addressLine1,
    address_line2: body.addressLine2,
    city: body.city,
    state_region: body.stateRegion,
    postal_code: body.postalCode,
    country: body.country,
    geo_lat: body.geoLat,
    geo_lng: body.geoLng,
    neighbourhood: body.neighbourhood,
    baptism_date: body.baptismDate,
    communion_date: body.communionDate,
    confirmation_date: body.confirmationDate,
    ordination_date: body.ordinationDate,
    spiritual_milestones: toJson(body.spiritualMilestones),
    status: body.status,
    joined_at: body.joinedAt,
    notes: body.notes,
    custom_fields: toJson(body.customFields),
  };
}

/** Map the camelCase patch body to a snake_case members Update row. */
function toMemberUpdate(body: UpdateMemberBody): Database["public"]["Tables"]["members"]["Update"] {
  return {
    user_id: body.userId,
    first_name: body.firstName,
    last_name: body.lastName,
    preferred_name: body.preferredName,
    email: body.email,
    phone: body.phone,
    date_of_birth: body.dateOfBirth,
    gender: body.gender,
    marital_status: body.maritalStatus,
    photo_url: body.photoUrl,
    address_line1: body.addressLine1,
    address_line2: body.addressLine2,
    city: body.city,
    state_region: body.stateRegion,
    postal_code: body.postalCode,
    country: body.country,
    geo_lat: body.geoLat,
    geo_lng: body.geoLng,
    neighbourhood: body.neighbourhood,
    baptism_date: body.baptismDate,
    communion_date: body.communionDate,
    confirmation_date: body.confirmationDate,
    ordination_date: body.ordinationDate,
    spiritual_milestones: toJson(body.spiritualMilestones),
    status: body.status,
    joined_at: body.joinedAt,
    notes: body.notes,
    custom_fields: toJson(body.customFields),
  };
}

type FieldChange = { from: unknown; to: unknown };

/**
 * Diff a patch against the existing row, by snake_case column. Skips columns the
 * patch didn't set (undefined); compares by JSON so jsonb/array changes register
 * without false positives from reference identity.
 */
function computeChanges(
  before: Record<string, unknown>,
  patch: Record<string, unknown>,
): Record<string, FieldChange> {
  const changes: Record<string, FieldChange> = {};
  for (const [key, to] of Object.entries(patch)) {
    if (to === undefined) continue;
    const from = before[key] ?? null;
    if (JSON.stringify(from) !== JSON.stringify(to)) {
      changes[key] = { from, to };
    }
  }
  return changes;
}

// PostgREST `or` uses , ( ) as structure and % _ as ilike wildcards; strip them
// from user input so a search term can't break (or inject into) the filter.
function sanitizeSearch(term: string): string {
  return term.replace(/[,()%_\\]/g, " ").trim();
}

export async function membersRoutes(app: FastifyInstance): Promise<void> {
  const r = app.withTypeProvider<ZodTypeProvider>();

  /**
   * Create a member in the caller's church. The church is taken from the JWT,
   * never the body. Logs a `note` creation event to the timeline.
   */
  r.post(
    "/members",
    {
      onRequest: [app.authenticate, requirePermission("members.write")],
      schema: {
        tags: ["members"],
        summary: "Create a member",
        description:
          "Creates a person record in the caller's church (taken from the JWT). Requires members.write.",
        security: [{ bearerAuth: [] }],
        body: createMemberBodyZ,
        response: {
          201: z.object({ member: memberZ, message: z.string() }),
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

      const supabase = createSupabaseAdminClient();
      const { data, error } = await supabase
        .from("members")
        .insert(toMemberInsert(req.body, auth.churchId))
        .select("*")
        .single();

      if (error || !data) {
        req.log.error({ err: error }, "member create failed");
        return reply.code(500).send({
          error: "CreateFailed",
          message: "Could not create the member. Please try again.",
        });
      }

      await logMemberEvent(
        supabase,
        {
          churchId: auth.churchId,
          memberId: data.id,
          eventType: "note",
          metadata: { action: "created", status: data.status },
          createdBy: auth.userId,
        },
        req.log,
      );
      // Index for search (best-effort, decoupled from the response).
      void syncMemberToIndex(data, req.log);

      // Welcome SMS (best-effort, fire-and-forget): only when the new member has a
      // phone and SMS is configured. Never blocks or fails the create; a sent
      // message is recorded as a `communication` timeline event.
      if (data.phone && isSmsConfigured()) {
        const phone = data.phone;
        const memberId = data.id;
        void (async () => {
          const { data: church } = await supabase
            .from("churches")
            .select("name")
            .eq("id", auth.churchId)
            .maybeSingle();
          const result = await sendSms(
            phone,
            buildWelcomeMessage(church?.name ?? "our church"),
            req.log,
          );
          if (result.sent) {
            await logMemberEvent(
              supabase,
              {
                churchId: auth.churchId,
                memberId,
                eventType: "communication",
                metadata: { channel: "sms", template: "welcome" },
                createdBy: auth.userId,
              },
              req.log,
            );
          }
        })();
      }

      return reply.code(201).send({ member: data, message: "Member created." });
    },
  );

  /**
   * List the church directory: paginated, optionally filtered by status and a
   * fuzzy name/email search (a simple ilike fallback; Meilisearch is the primary
   * search path, Task 4).
   */
  r.get(
    "/members",
    {
      onRequest: [app.authenticate, requirePermission("members.read")],
      schema: {
        tags: ["members"],
        summary: "List members",
        description:
          "Paginated, filterable list of the caller's church directory. Requires members.read.",
        security: [{ bearerAuth: [] }],
        querystring: memberListQueryZ,
        response: {
          200: z.object({ members: z.array(memberZ), pagination: paginationZ }),
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

      const { page, pageSize, status, search, includeDeleted } = req.query;
      const from = (page - 1) * pageSize;
      const to = from + pageSize - 1;

      const supabase = createSupabaseAdminClient();
      let query = supabase
        .from("members")
        .select("*", { count: "exact" })
        .eq("church_id", auth.churchId);

      // Hide soft-deleted members unless explicitly asked for.
      if (includeDeleted !== "true") query = query.is("deleted_at", null);
      if (status) query = query.eq("status", status);
      if (search) {
        const safe = sanitizeSearch(search);
        if (safe) {
          const like = `%${safe}%`;
          query = query.or(
            `first_name.ilike.${like},last_name.ilike.${like},preferred_name.ilike.${like},email.ilike.${like}`,
          );
        }
      }

      const { data, error, count } = await query
        .order("created_at", { ascending: false })
        .range(from, to);

      if (error) {
        req.log.error({ err: error }, "member list failed");
        return reply.code(500).send({
          error: "ListFailed",
          message: "Could not list members. Please try again.",
        });
      }

      const total = count ?? 0;
      const totalPages = total === 0 ? 0 : Math.ceil(total / pageSize);
      return reply.code(200).send({
        members: data ?? [],
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

  /**
   * A member's full profile: the record plus its recent timeline. Household and
   * group memberships are added once those features land (Tasks 6 and 8).
   */
  r.get(
    "/members/:id",
    {
      onRequest: [app.authenticate, requirePermission("members.read")],
      schema: {
        tags: ["members"],
        summary: "Get a member profile",
        description:
          "Full profile for one member in the caller's church (record + recent timeline). Requires members.read.",
        security: [{ bearerAuth: [] }],
        params: memberIdParamsZ,
        querystring: includeDeletedQueryZ,
        response: {
          200: z.object({
            member: memberZ,
            timeline: z.array(memberTimelineEventZ),
            household: memberHouseholdSummaryZ.nullable(),
            groups: z.array(memberGroupSummaryZ),
          }),
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

      const supabase = createSupabaseAdminClient();
      let memberQuery = supabase
        .from("members")
        .select("*")
        .eq("church_id", auth.churchId)
        .eq("id", req.params.id);
      if (req.query.includeDeleted !== "true") {
        memberQuery = memberQuery.is("deleted_at", null);
      }
      const { data: member, error } = await memberQuery.maybeSingle();

      if (error) {
        req.log.error({ err: error }, "member fetch failed");
        return reply.code(500).send({
          error: "FetchFailed",
          message: "Could not load the member. Please try again.",
        });
      }
      if (!member) {
        return reply.code(404).send({
          error: "MemberNotFound",
          message: "No member exists with that id in this church.",
        });
      }

      const { data: timeline, error: tlErr } = await supabase
        .from("member_timeline")
        .select("*")
        .eq("church_id", auth.churchId)
        .eq("member_id", req.params.id)
        .order("occurred_at", { ascending: false })
        .limit(100);

      if (tlErr) {
        req.log.warn({ err: tlErr, memberId: req.params.id }, "member timeline fetch failed");
      }

      // The member's household membership (if any), embedded in the profile.
      let household = null;
      const { data: link, error: linkErr } = await supabase
        .from("household_members")
        .select("relationship_type, household_id")
        .eq("church_id", auth.churchId)
        .eq("member_id", req.params.id)
        .limit(1)
        .maybeSingle();
      if (linkErr) {
        req.log.warn({ err: linkErr, memberId: req.params.id }, "household lookup failed");
      } else if (link) {
        const { data: hh } = await supabase
          .from("households")
          .select("*")
          .eq("church_id", auth.churchId)
          .eq("id", link.household_id)
          .maybeSingle();
        if (hh) household = { household: hh, relationship_type: link.relationship_type };
      }

      // The groups the member belongs to (with their role in each).
      const groups: Array<{
        group: Database["public"]["Tables"]["groups"]["Row"];
        role: string | null;
      }> = [];
      const { data: groupLinks, error: groupErr } = await supabase
        .from("group_members")
        .select("role, group_id")
        .eq("church_id", auth.churchId)
        .eq("member_id", req.params.id);
      if (groupErr) {
        req.log.warn({ err: groupErr, memberId: req.params.id }, "member groups fetch failed");
      } else if (groupLinks && groupLinks.length > 0) {
        const groupIds = groupLinks.map((l) => l.group_id);
        const { data: groupRows } = await supabase
          .from("groups")
          .select("*")
          .eq("church_id", auth.churchId)
          .in("id", groupIds);
        const groupsById = new Map((groupRows ?? []).map((g) => [g.id, g]));
        for (const l of groupLinks) {
          const group = groupsById.get(l.group_id);
          if (group) groups.push({ group, role: l.role });
        }
      }

      return reply.code(200).send({ member, timeline: timeline ?? [], household, groups });
    },
  );

  /**
   * Partially update a member. Fetches the current row (404 if absent in this
   * church), applies the patch via service_role, and appends a timeline event
   * recording the old vs new value of every changed field. A patch that changes
   * `status` is logged as a status_change; otherwise as a note.
   */
  r.patch(
    "/members/:id",
    {
      onRequest: [app.authenticate, requirePermission("members.write")],
      schema: {
        tags: ["members"],
        summary: "Update a member",
        description:
          "Partially updates a member in the caller's church and logs the change to the timeline. Requires members.write.",
        security: [{ bearerAuth: [] }],
        params: memberIdParamsZ,
        body: updateMemberBodyZ,
        response: {
          200: z.object({ member: memberZ, message: z.string() }),
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

      const supabase = createSupabaseAdminClient();
      // Only live members are editable; restore a soft-deleted one first.
      const { data: existing, error: fetchErr } = await supabase
        .from("members")
        .select("*")
        .eq("church_id", auth.churchId)
        .eq("id", req.params.id)
        .is("deleted_at", null)
        .maybeSingle();

      if (fetchErr) {
        req.log.error({ err: fetchErr }, "member fetch (for update) failed");
        return reply.code(500).send({
          error: "UpdateFailed",
          message: "Could not update the member. Please try again.",
        });
      }
      if (!existing) {
        return reply.code(404).send({
          error: "MemberNotFound",
          message: "No member exists with that id in this church.",
        });
      }

      const patch = toMemberUpdate(req.body);
      const changes = computeChanges(
        existing as Record<string, unknown>,
        patch as Record<string, unknown>,
      );

      const { data: updated, error: updateErr } = await supabase
        .from("members")
        .update(patch)
        .eq("church_id", auth.churchId)
        .eq("id", req.params.id)
        .is("deleted_at", null)
        .select("*")
        .single();

      if (updateErr || !updated) {
        req.log.error({ err: updateErr }, "member update failed");
        return reply.code(500).send({
          error: "UpdateFailed",
          message: "Could not update the member. Please try again.",
        });
      }

      if (Object.keys(changes).length > 0) {
        await logMemberEvent(
          supabase,
          {
            churchId: auth.churchId,
            memberId: updated.id,
            eventType: "status" in changes ? "status_change" : "note",
            metadata: { action: "updated", changes },
            createdBy: auth.userId,
          },
          req.log,
        );
      }
      void syncMemberToIndex(updated, req.log);

      return reply.code(200).send({ member: updated, message: "Member updated." });
    },
  );

  /**
   * Soft-delete a member: set deleted_at, drop it from the search index, and log
   * the removal. Never hard-deletes, so history survives and the member can be
   * restored. Idempotent-safe: deleting an already-deleted member is a 404.
   */
  r.delete(
    "/members/:id",
    {
      onRequest: [app.authenticate, requirePermission("members.delete")],
      schema: {
        tags: ["members"],
        summary: "Soft-delete a member",
        description:
          "Marks a member deleted (sets deleted_at); the row is retained and can be restored. Requires members.delete.",
        security: [{ bearerAuth: [] }],
        params: memberIdParamsZ,
        response: {
          200: z.object({ member: memberZ, message: z.string() }),
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

      const supabase = createSupabaseAdminClient();
      const { data, error } = await supabase
        .from("members")
        .update({ deleted_at: new Date().toISOString() })
        .eq("church_id", auth.churchId)
        .eq("id", req.params.id)
        .is("deleted_at", null)
        .select("*")
        .maybeSingle();

      if (error) {
        req.log.error({ err: error }, "member soft-delete failed");
        return reply.code(500).send({
          error: "DeleteFailed",
          message: "Could not delete the member. Please try again.",
        });
      }
      if (!data) {
        return reply.code(404).send({
          error: "MemberNotFound",
          message: "No active member exists with that id in this church.",
        });
      }

      await logMemberEvent(
        supabase,
        {
          churchId: auth.churchId,
          memberId: data.id,
          eventType: "note",
          metadata: { action: "soft_deleted" },
          createdBy: auth.userId,
        },
        req.log,
      );
      void removeMemberFromIndex(data.id, req.log);

      return reply.code(200).send({ member: data, message: "Member deleted." });
    },
  );

  /**
   * Restore a soft-deleted member: clear deleted_at, re-index it, and log the
   * restore. A 404 if the member doesn't exist or isn't currently deleted.
   */
  r.post(
    "/members/:id/restore",
    {
      onRequest: [app.authenticate, requirePermission("members.delete")],
      schema: {
        tags: ["members"],
        summary: "Restore a member",
        description:
          "Clears a member's deleted_at, returning them to the active directory. Requires members.delete.",
        security: [{ bearerAuth: [] }],
        params: memberIdParamsZ,
        response: {
          200: z.object({ member: memberZ, message: z.string() }),
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

      const supabase = createSupabaseAdminClient();
      const { data, error } = await supabase
        .from("members")
        .update({ deleted_at: null })
        .eq("church_id", auth.churchId)
        .eq("id", req.params.id)
        .not("deleted_at", "is", null)
        .select("*")
        .maybeSingle();

      if (error) {
        req.log.error({ err: error }, "member restore failed");
        return reply.code(500).send({
          error: "RestoreFailed",
          message: "Could not restore the member. Please try again.",
        });
      }
      if (!data) {
        return reply.code(404).send({
          error: "MemberNotFound",
          message: "No soft-deleted member exists with that id in this church.",
        });
      }

      await logMemberEvent(
        supabase,
        {
          churchId: auth.churchId,
          memberId: data.id,
          eventType: "note",
          metadata: { action: "restored" },
          createdBy: auth.userId,
        },
        req.log,
      );
      void syncMemberToIndex(data, req.log);

      return reply.code(200).send({ member: data, message: "Member restored." });
    },
  );

  /**
   * Change a member's lifecycle status through the validated state machine (see
   * ../lib/member-status.ts). A no-op (same status) returns 200 unchanged; a
   * disallowed move is a 409 that lists the allowed targets. On a real change it
   * writes the status, appends a status_change timeline event, and fires the
   * workflow hooks. Requires members.write. (PATCH /members/:id can also set
   * status directly; this endpoint is the guarded lifecycle path.)
   */
  r.post(
    "/members/:id/status",
    {
      onRequest: [app.authenticate, requirePermission("members.write")],
      schema: {
        tags: ["members"],
        summary: "Change a member's status",
        description:
          "Transitions a member to a new lifecycle status if the move is allowed, logging a status_change and firing workflow hooks. Requires members.write.",
        security: [{ bearerAuth: [] }],
        params: memberIdParamsZ,
        body: memberStatusTransitionBodyZ,
        response: {
          200: z.object({ member: memberZ, message: z.string() }),
          400: errorZ,
          401: errorZ,
          403: errorZ,
          404: errorZ,
          409: errorZ,
          500: errorZ,
        },
      },
    },
    async (req, reply) => {
      const auth = requireChurchScopedAuth(req, reply);
      if (!auth) return reply;

      const supabase = createSupabaseAdminClient();
      const { data: existing, error: fetchErr } = await supabase
        .from("members")
        .select("*")
        .eq("church_id", auth.churchId)
        .eq("id", req.params.id)
        .is("deleted_at", null)
        .maybeSingle();

      if (fetchErr) {
        req.log.error({ err: fetchErr }, "member fetch (for status change) failed");
        return reply.code(500).send({
          error: "StatusChangeFailed",
          message: "Could not change the member's status. Please try again.",
        });
      }
      if (!existing) {
        return reply.code(404).send({
          error: "MemberNotFound",
          message: "No active member exists with that id in this church.",
        });
      }

      const from = existing.status;
      const to = req.body.status;

      if (from === to) {
        return reply.code(200).send({ member: existing, message: `Member is already ${to}.` });
      }
      if (!canTransition(from, to)) {
        return reply.code(409).send({
          error: "InvalidTransition",
          message: `Cannot change status from "${from}" to "${to}". Allowed: ${allowedNextStatuses(from).join(", ")}.`,
        });
      }

      const updated = await applyStatusChange(
        supabase,
        {
          churchId: auth.churchId,
          memberId: req.params.id,
          from,
          to,
          reason: req.body.reason,
          actorId: auth.userId,
        },
        req.log,
      );
      if (!updated) {
        return reply.code(500).send({
          error: "StatusChangeFailed",
          message: "Could not change the member's status. Please try again.",
        });
      }

      void syncMemberToIndex(updated, req.log);
      return reply.code(200).send({ member: updated, message: `Member status changed to ${to}.` });
    },
  );

  /**
   * Full-text member search via Meilisearch (fuzzy/typo-tolerant, scoped to the
   * caller's church). Returns 503 when search isn't configured or is down — the
   * paginated list (with its ilike `search`) remains the always-available path.
   */
  r.get(
    "/members/search",
    {
      onRequest: [app.authenticate, requirePermission("members.read")],
      schema: {
        tags: ["members"],
        summary: "Search members",
        description:
          "Typo-tolerant full-text search of the caller's church directory. Requires members.read.",
        security: [{ bearerAuth: [] }],
        querystring: memberSearchQueryZ,
        response: {
          200: z.object({
            query: z.string(),
            hits: z.array(memberSearchHitZ),
            estimatedTotalHits: z.number().int(),
            limit: z.number().int(),
            offset: z.number().int(),
          }),
          400: errorZ,
          401: errorZ,
          403: errorZ,
          500: errorZ,
          503: errorZ,
        },
      },
    },
    async (req, reply) => {
      const auth = requireChurchScopedAuth(req, reply);
      if (!auth) return reply;

      if (!isMeiliConfigured()) {
        return reply.code(503).send({
          error: "SearchUnavailable",
          message: "Search is not configured on this server.",
        });
      }

      const { q, page, pageSize } = req.query;
      const offset = (page - 1) * pageSize;

      try {
        const result = await searchMembers(auth.churchId, q, { limit: pageSize, offset });
        return reply.code(200).send({
          query: q,
          hits: result.hits,
          estimatedTotalHits: result.estimatedTotalHits,
          limit: result.limit,
          offset: result.offset,
        });
      } catch (err) {
        req.log.error({ err }, "member search failed");
        return reply.code(503).send({
          error: "SearchUnavailable",
          message: "Search is temporarily unavailable. Please try again.",
        });
      }
    },
  );
}
