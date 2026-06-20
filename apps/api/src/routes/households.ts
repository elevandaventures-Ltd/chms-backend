import type { FastifyInstance } from "fastify";
import { z } from "zod";
import { createSupabaseAdminClient, type Database } from "@repo/db";
import { requireChurchScopedAuth, requirePermission } from "../guards.js";
import type { ZodTypeProvider } from "../lib/zod.js";
import {
  errorZ,
  householdRelationshipTypeZ,
  householdZ,
  memberZ,
  paginationZ,
} from "../lib/schemas.js";
import {
  isMeiliConfigured,
  removeHouseholdFromIndex,
  searchHouseholds,
  syncHouseholdToIndex,
} from "../lib/meili.js";

/**
 * Household (family grouping) endpoints + member<->household family linking.
 *
 * Households are member data, so they reuse the member permissions: reads need
 * members.read, writes (including household delete and family linking) need
 * members.write. There is no households-specific soft-delete: deleting a
 * household removes the grouping (household_members links cascade away) but never
 * touches the member rows themselves. Same JWT-scoped, service_role-for-writes
 * pattern as the members routes.
 */

// Postgres unique_violation — surfaced by supabase-js as error.code.
const PG_UNIQUE_VIOLATION = "23505";

const LAT = { min: -90, max: 90 };
const LNG = { min: -180, max: 180 };

const createHouseholdBodyZ = z.strictObject({
  name: z.string().min(1).max(200),
  address: z.string().max(1000).optional(),
  geoLat: z.number().min(LAT.min).max(LAT.max).optional(),
  geoLng: z.number().min(LNG.min).max(LNG.max).optional(),
});

const updateHouseholdBodyZ = z
  .strictObject({
    name: z.string().min(1).max(200).optional(),
    address: z.string().max(1000).nullish(),
    geoLat: z.number().min(LAT.min).max(LAT.max).nullish(),
    geoLng: z.number().min(LNG.min).max(LNG.max).nullish(),
  })
  .refine((obj) => Object.keys(obj).length > 0, {
    message: "Provide at least one field to update.",
  });

const householdListQueryZ = z.object({
  page: z.coerce.number().int().min(1).default(1),
  pageSize: z.coerce.number().int().min(1).max(100).default(20),
  search: z.string().trim().min(1).max(200).optional(),
});

const householdIdParamsZ = z.strictObject({ id: z.uuid() });

const unlinkParamsZ = z.strictObject({ id: z.uuid(), memberId: z.uuid() });

const linkMemberBodyZ = z.strictObject({
  memberId: z.uuid(),
  relationshipType: householdRelationshipTypeZ,
});

const householdMemberLinkZ = z.object({
  household_id: z.string(),
  member_id: z.string(),
  relationship_type: householdRelationshipTypeZ,
  created_at: z.string(),
});

const householdMemberEntryZ = z.object({
  member: memberZ,
  relationship_type: householdRelationshipTypeZ,
});

const householdSearchQueryZ = z.object({
  q: z.string().trim().min(1).max(200),
  page: z.coerce.number().int().min(1).default(1),
  pageSize: z.coerce.number().int().min(1).max(100).default(20),
});

const householdSearchHitZ = z.object({
  id: z.string(),
  church_id: z.string(),
  name: z.string(),
  address: z.string().nullable(),
});

// ilike wildcards (% _) and escapes stripped so search input is treated literally.
function sanitizeSearch(term: string): string {
  return term.replace(/[%_\\]/g, " ").trim();
}

export async function householdsRoutes(app: FastifyInstance): Promise<void> {
  const r = app.withTypeProvider<ZodTypeProvider>();

  /** Create a household in the caller's church (church taken from the JWT). */
  r.post(
    "/households",
    {
      onRequest: [app.authenticate, requirePermission("members.write")],
      schema: {
        tags: ["households"],
        summary: "Create a household",
        description: "Creates a family grouping in the caller's church. Requires members.write.",
        security: [{ bearerAuth: [] }],
        body: createHouseholdBodyZ,
        response: {
          201: z.object({ household: householdZ, message: z.string() }),
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

      const insert: Database["public"]["Tables"]["households"]["Insert"] = {
        church_id: auth.churchId,
        name: req.body.name,
        address: req.body.address,
        geo_lat: req.body.geoLat,
        geo_lng: req.body.geoLng,
      };

      const supabase = createSupabaseAdminClient();
      const { data, error } = await supabase.from("households").insert(insert).select("*").single();

      if (error || !data) {
        req.log.error({ err: error }, "household create failed");
        return reply.code(500).send({
          error: "CreateFailed",
          message: "Could not create the household. Please try again.",
        });
      }

      void syncHouseholdToIndex(data, req.log);
      return reply.code(201).send({ household: data, message: "Household created." });
    },
  );

  /** List households in the caller's church: paginated, optional name search. */
  r.get(
    "/households",
    {
      onRequest: [app.authenticate, requirePermission("members.read")],
      schema: {
        tags: ["households"],
        summary: "List households",
        description: "Paginated list of households in the caller's church. Requires members.read.",
        security: [{ bearerAuth: [] }],
        querystring: householdListQueryZ,
        response: {
          200: z.object({ households: z.array(householdZ), pagination: paginationZ }),
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

      const { page, pageSize, search } = req.query;
      const from = (page - 1) * pageSize;
      const to = from + pageSize - 1;

      const supabase = createSupabaseAdminClient();
      let query = supabase
        .from("households")
        .select("*", { count: "exact" })
        .eq("church_id", auth.churchId);

      if (search) {
        const safe = sanitizeSearch(search);
        if (safe) query = query.ilike("name", `%${safe}%`);
      }

      const { data, error, count } = await query.order("name", { ascending: true }).range(from, to);

      if (error) {
        req.log.error({ err: error }, "household list failed");
        return reply.code(500).send({
          error: "ListFailed",
          message: "Could not list households. Please try again.",
        });
      }

      const total = count ?? 0;
      const totalPages = total === 0 ? 0 : Math.ceil(total / pageSize);
      return reply.code(200).send({
        households: data ?? [],
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

  /** A household with its member roster (each member tagged with relationship). */
  r.get(
    "/households/:id",
    {
      onRequest: [app.authenticate, requirePermission("members.read")],
      schema: {
        tags: ["households"],
        summary: "Get a household",
        description:
          "A household plus its (active) members and their relationships. Requires members.read.",
        security: [{ bearerAuth: [] }],
        params: householdIdParamsZ,
        response: {
          200: z.object({
            household: householdZ,
            members: z.array(householdMemberEntryZ),
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
      const { data: household, error } = await supabase
        .from("households")
        .select("*")
        .eq("church_id", auth.churchId)
        .eq("id", req.params.id)
        .maybeSingle();

      if (error) {
        req.log.error({ err: error }, "household fetch failed");
        return reply.code(500).send({
          error: "FetchFailed",
          message: "Could not load the household. Please try again.",
        });
      }
      if (!household) {
        return reply.code(404).send({
          error: "HouseholdNotFound",
          message: "No household exists with that id in this church.",
        });
      }

      const { data: links, error: linksErr } = await supabase
        .from("household_members")
        .select("relationship_type, member_id")
        .eq("church_id", auth.churchId)
        .eq("household_id", req.params.id);

      if (linksErr) {
        req.log.error({ err: linksErr }, "household members fetch failed");
        return reply.code(500).send({
          error: "FetchFailed",
          message: "Could not load the household. Please try again.",
        });
      }

      const memberIds = (links ?? []).map((l) => l.member_id);
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

      const entries = (links ?? []).flatMap((l) => {
        const member = membersById.get(l.member_id);
        return member ? [{ member, relationship_type: l.relationship_type }] : [];
      });

      return reply.code(200).send({ household, members: entries });
    },
  );

  /** Partially update a household. */
  r.patch(
    "/households/:id",
    {
      onRequest: [app.authenticate, requirePermission("members.write")],
      schema: {
        tags: ["households"],
        summary: "Update a household",
        description:
          "Partially updates a household in the caller's church. Requires members.write.",
        security: [{ bearerAuth: [] }],
        params: householdIdParamsZ,
        body: updateHouseholdBodyZ,
        response: {
          200: z.object({ household: householdZ, message: z.string() }),
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

      const patch: Database["public"]["Tables"]["households"]["Update"] = {
        name: req.body.name,
        address: req.body.address,
        geo_lat: req.body.geoLat,
        geo_lng: req.body.geoLng,
      };

      const supabase = createSupabaseAdminClient();
      const { data, error } = await supabase
        .from("households")
        .update(patch)
        .eq("church_id", auth.churchId)
        .eq("id", req.params.id)
        .select("*")
        .maybeSingle();

      if (error) {
        req.log.error({ err: error }, "household update failed");
        return reply.code(500).send({
          error: "UpdateFailed",
          message: "Could not update the household. Please try again.",
        });
      }
      if (!data) {
        return reply.code(404).send({
          error: "HouseholdNotFound",
          message: "No household exists with that id in this church.",
        });
      }

      void syncHouseholdToIndex(data, req.log);
      return reply.code(200).send({ household: data, message: "Household updated." });
    },
  );

  /** Delete a household (its member links cascade; the members themselves stay). */
  r.delete(
    "/households/:id",
    {
      onRequest: [app.authenticate, requirePermission("members.write")],
      schema: {
        tags: ["households"],
        summary: "Delete a household",
        description:
          "Deletes a household and its member links; the member records are untouched. Requires members.write.",
        security: [{ bearerAuth: [] }],
        params: householdIdParamsZ,
        response: {
          200: z.object({ message: z.string() }),
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
        .from("households")
        .delete()
        .eq("church_id", auth.churchId)
        .eq("id", req.params.id)
        .select("id");

      if (error) {
        req.log.error({ err: error }, "household delete failed");
        return reply.code(500).send({
          error: "DeleteFailed",
          message: "Could not delete the household. Please try again.",
        });
      }
      if (!data || data.length === 0) {
        return reply.code(404).send({
          error: "HouseholdNotFound",
          message: "No household exists with that id in this church.",
        });
      }

      void removeHouseholdFromIndex(req.params.id, req.log);
      return reply.code(200).send({ message: "Household deleted." });
    },
  );

  /** Link a member to a household with a family relationship. */
  r.post(
    "/households/:id/members",
    {
      onRequest: [app.authenticate, requirePermission("members.write")],
      schema: {
        tags: ["households"],
        summary: "Link a member to a household",
        description:
          "Adds a member to a household with a relationship (parent/child/spouse/sibling). Requires members.write.",
        security: [{ bearerAuth: [] }],
        params: householdIdParamsZ,
        body: linkMemberBodyZ,
        response: {
          201: z.object({ link: householdMemberLinkZ, message: z.string() }),
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

      // The household and member must both exist in the caller's church.
      const [householdRes, memberRes] = await Promise.all([
        supabase
          .from("households")
          .select("id")
          .eq("church_id", auth.churchId)
          .eq("id", req.params.id)
          .maybeSingle(),
        supabase
          .from("members")
          .select("id")
          .eq("church_id", auth.churchId)
          .eq("id", req.body.memberId)
          .is("deleted_at", null)
          .maybeSingle(),
      ]);

      if (householdRes.error || memberRes.error) {
        req.log.error(
          { err: householdRes.error ?? memberRes.error },
          "household link lookup failed",
        );
        return reply.code(500).send({
          error: "LinkFailed",
          message: "Could not link the member. Please try again.",
        });
      }
      if (!householdRes.data) {
        return reply.code(404).send({
          error: "HouseholdNotFound",
          message: "No household exists with that id in this church.",
        });
      }
      if (!memberRes.data) {
        return reply.code(404).send({
          error: "MemberNotFound",
          message: "No active member exists with that id in this church.",
        });
      }

      const { data, error } = await supabase
        .from("household_members")
        .insert({
          household_id: req.params.id,
          member_id: req.body.memberId,
          church_id: auth.churchId,
          relationship_type: req.body.relationshipType,
          created_by: auth.userId,
        })
        .select("household_id, member_id, relationship_type, created_at")
        .single();

      if (error || !data) {
        if (error?.code === PG_UNIQUE_VIOLATION) {
          return reply.code(409).send({
            error: "AlreadyLinked",
            message: "That member is already in this household.",
          });
        }
        req.log.error({ err: error }, "household link insert failed");
        return reply.code(500).send({
          error: "LinkFailed",
          message: "Could not link the member. Please try again.",
        });
      }

      return reply.code(201).send({ link: data, message: "Member linked to household." });
    },
  );

  /** Remove a member from a household. */
  r.delete(
    "/households/:id/members/:memberId",
    {
      onRequest: [app.authenticate, requirePermission("members.write")],
      schema: {
        tags: ["households"],
        summary: "Unlink a member from a household",
        description: "Removes a member from a household. Requires members.write.",
        security: [{ bearerAuth: [] }],
        params: unlinkParamsZ,
        response: {
          200: z.object({ message: z.string() }),
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
        .from("household_members")
        .delete()
        .eq("church_id", auth.churchId)
        .eq("household_id", req.params.id)
        .eq("member_id", req.params.memberId)
        .select("member_id");

      if (error) {
        req.log.error({ err: error }, "household unlink failed");
        return reply.code(500).send({
          error: "UnlinkFailed",
          message: "Could not unlink the member. Please try again.",
        });
      }
      if (!data || data.length === 0) {
        return reply.code(404).send({
          error: "LinkNotFound",
          message: "That member is not in this household.",
        });
      }

      return reply.code(200).send({ message: "Member unlinked from household." });
    },
  );

  /**
   * Full-text household search via Meilisearch (typo-tolerant, scoped to the
   * caller's church). Returns 503 when search isn't configured or is down; the
   * plain list (GET /households with its ilike `search`) is the fallback path.
   * Households reuse the member permissions, so this needs members.read.
   */
  r.get(
    "/households/search",
    {
      onRequest: [app.authenticate, requirePermission("members.read")],
      schema: {
        tags: ["households"],
        summary: "Search households",
        description:
          "Typo-tolerant full-text search of the caller's church households. Requires members.read.",
        security: [{ bearerAuth: [] }],
        querystring: householdSearchQueryZ,
        response: {
          200: z.object({
            query: z.string(),
            hits: z.array(householdSearchHitZ),
            estimatedTotalHits: z.number().int(),
            limit: z.number().int(),
            offset: z.number().int(),
          }),
          400: errorZ,
          401: errorZ,
          403: errorZ,
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
        const result = await searchHouseholds(auth.churchId, q, { limit: pageSize, offset });
        return reply.code(200).send({
          query: q,
          hits: result.hits,
          estimatedTotalHits: result.estimatedTotalHits,
          limit: result.limit,
          offset: result.offset,
        });
      } catch (err) {
        req.log.error({ err }, "household search failed");
        return reply.code(503).send({
          error: "SearchUnavailable",
          message: "Search is temporarily unavailable. Please try again.",
        });
      }
    },
  );
}
