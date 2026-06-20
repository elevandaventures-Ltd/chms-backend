import type { FastifyInstance } from "fastify";
import { z } from "zod";
import { createSupabaseAdminClient, type Database, type SupabaseClient } from "@repo/db";
import { requireChurchScopedAuth, requirePermission } from "../guards.js";
import type { ZodTypeProvider } from "../lib/zod.js";
import { errorZ, groupTypeZ, groupZ, memberZ } from "../lib/schemas.js";
import { logMemberEvent } from "../lib/timeline.js";
import {
  isMeiliConfigured,
  removeGroupFromIndex,
  searchGroups,
  syncGroupToIndex,
} from "../lib/meili.js";

/**
 * Group/ministry endpoints + member-group assignment.
 *
 * Groups form a hierarchy via the adjacency list in public.groups (parent_id
 * self-reference). Reads need groups.read; writes (including assignment) need
 * groups.write. Reparenting is guarded against cycles. Assigning/removing a
 * member logs a group_join / group_leave event to that member's timeline.
 */

const PG_UNIQUE_VIOLATION = "23505";

const createGroupBodyZ = z.strictObject({
  name: z.string().min(1).max(200),
  groupType: groupTypeZ,
  parentId: z.uuid().nullish(),
  description: z.string().max(2000).optional(),
});

const updateGroupBodyZ = z
  .strictObject({
    name: z.string().min(1).max(200).optional(),
    groupType: groupTypeZ.optional(),
    parentId: z.uuid().nullish(),
    description: z.string().max(2000).nullish(),
  })
  .refine((obj) => Object.keys(obj).length > 0, {
    message: "Provide at least one field to update.",
  });

const groupListQueryZ = z.object({
  groupType: groupTypeZ.optional(),
  parentId: z.uuid().optional(),
  search: z.string().trim().min(1).max(200).optional(),
});

const groupIdParamsZ = z.strictObject({ id: z.uuid() });

const unassignParamsZ = z.strictObject({ id: z.uuid(), memberId: z.uuid() });

const assignMemberBodyZ = z.strictObject({
  memberId: z.uuid(),
  role: z.string().min(1).max(100).optional(),
});

const groupMemberLinkZ = z.object({
  group_id: z.string(),
  member_id: z.string(),
  role: z.string().nullable(),
  created_at: z.string(),
});

const groupMemberEntryZ = z.object({
  member: memberZ,
  role: z.string().nullable(),
});

const groupSearchQueryZ = z.object({
  q: z.string().trim().min(1).max(200),
  page: z.coerce.number().int().min(1).default(1),
  pageSize: z.coerce.number().int().min(1).max(100).default(20),
});

const groupSearchHitZ = z.object({
  id: z.string(),
  church_id: z.string(),
  name: z.string(),
  description: z.string().nullable(),
  group_type: z.string(),
});

function sanitizeSearch(term: string): string {
  return term.replace(/[%_\\]/g, " ").trim();
}

/**
 * True if making `newParentId` the parent of `groupId` would form a cycle, i.e.
 * `groupId` is `newParentId` or one of its ancestors. Walks the ancestor chain;
 * the `seen` set also stops a pre-existing cycle from looping forever.
 */
async function wouldCreateCycle(
  supabase: SupabaseClient<Database>,
  churchId: string,
  groupId: string,
  newParentId: string,
): Promise<boolean> {
  let current: string | null = newParentId;
  const seen = new Set<string>();
  while (current) {
    const node: string = current;
    if (node === groupId) return true;
    if (seen.has(node)) break;
    seen.add(node);
    const { data } = await supabase
      .from("groups")
      .select("parent_id")
      .eq("church_id", churchId)
      .eq("id", node)
      .maybeSingle();
    current = data?.parent_id ?? null;
  }
  return false;
}

export async function groupsRoutes(app: FastifyInstance): Promise<void> {
  const r = app.withTypeProvider<ZodTypeProvider>();

  /** Create a group. A parent, if given, must exist in the caller's church. */
  r.post(
    "/groups",
    {
      onRequest: [app.authenticate, requirePermission("groups.write")],
      schema: {
        tags: ["groups"],
        summary: "Create a group",
        description:
          "Creates a group/ministry node. parentId null/omitted makes a root. Requires groups.write.",
        security: [{ bearerAuth: [] }],
        body: createGroupBodyZ,
        response: {
          201: z.object({ group: groupZ, message: z.string() }),
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

      if (req.body.parentId) {
        const { data: parent, error: parentErr } = await supabase
          .from("groups")
          .select("id")
          .eq("church_id", auth.churchId)
          .eq("id", req.body.parentId)
          .maybeSingle();
        if (parentErr) {
          req.log.error({ err: parentErr }, "group parent lookup failed");
          return reply.code(500).send({
            error: "CreateFailed",
            message: "Could not create the group. Please try again.",
          });
        }
        if (!parent) {
          return reply.code(404).send({
            error: "ParentNotFound",
            message: "No parent group exists with that id in this church.",
          });
        }
      }

      const insert: Database["public"]["Tables"]["groups"]["Insert"] = {
        church_id: auth.churchId,
        name: req.body.name,
        group_type: req.body.groupType,
        parent_id: req.body.parentId,
        description: req.body.description,
      };

      const { data, error } = await supabase.from("groups").insert(insert).select("*").single();

      if (error || !data) {
        req.log.error({ err: error }, "group create failed");
        return reply.code(500).send({
          error: "CreateFailed",
          message: "Could not create the group. Please try again.",
        });
      }

      void syncGroupToIndex(data, req.log);
      return reply.code(201).send({ group: data, message: "Group created." });
    },
  );

  /**
   * Flat list of the church's groups (clients assemble the tree from parent_id),
   * filterable by type, parent, and name.
   */
  r.get(
    "/groups",
    {
      onRequest: [app.authenticate, requirePermission("groups.read")],
      schema: {
        tags: ["groups"],
        summary: "List groups",
        description:
          "Flat list of the caller's church groups, filterable by type/parent/name. Requires groups.read.",
        security: [{ bearerAuth: [] }],
        querystring: groupListQueryZ,
        response: {
          200: z.object({ groups: z.array(groupZ) }),
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

      const { groupType, parentId, search } = req.query;
      const supabase = createSupabaseAdminClient();
      let query = supabase.from("groups").select("*").eq("church_id", auth.churchId);

      if (groupType) query = query.eq("group_type", groupType);
      if (parentId) query = query.eq("parent_id", parentId);
      if (search) {
        const safe = sanitizeSearch(search);
        if (safe) query = query.ilike("name", `%${safe}%`);
      }

      const { data, error } = await query.order("name", { ascending: true });

      if (error) {
        req.log.error({ err: error }, "group list failed");
        return reply.code(500).send({
          error: "ListFailed",
          message: "Could not list groups. Please try again.",
        });
      }

      return reply.code(200).send({ groups: data ?? [] });
    },
  );

  /** A group with its immediate child groups and its member roster. */
  r.get(
    "/groups/:id",
    {
      onRequest: [app.authenticate, requirePermission("groups.read")],
      schema: {
        tags: ["groups"],
        summary: "Get a group",
        description:
          "A group plus its immediate children and its (active) members. Requires groups.read.",
        security: [{ bearerAuth: [] }],
        params: groupIdParamsZ,
        response: {
          200: z.object({
            group: groupZ,
            children: z.array(groupZ),
            members: z.array(groupMemberEntryZ),
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
      const { data: group, error } = await supabase
        .from("groups")
        .select("*")
        .eq("church_id", auth.churchId)
        .eq("id", req.params.id)
        .maybeSingle();

      if (error) {
        req.log.error({ err: error }, "group fetch failed");
        return reply.code(500).send({
          error: "FetchFailed",
          message: "Could not load the group. Please try again.",
        });
      }
      if (!group) {
        return reply.code(404).send({
          error: "GroupNotFound",
          message: "No group exists with that id in this church.",
        });
      }

      const [childrenRes, linksRes] = await Promise.all([
        supabase
          .from("groups")
          .select("*")
          .eq("church_id", auth.churchId)
          .eq("parent_id", req.params.id)
          .order("name", { ascending: true }),
        supabase
          .from("group_members")
          .select("role, member_id")
          .eq("church_id", auth.churchId)
          .eq("group_id", req.params.id),
      ]);

      if (childrenRes.error || linksRes.error) {
        req.log.error(
          { err: childrenRes.error ?? linksRes.error },
          "group children/members fetch failed",
        );
        return reply.code(500).send({
          error: "FetchFailed",
          message: "Could not load the group. Please try again.",
        });
      }

      const links = linksRes.data ?? [];
      const memberIds = links.map((l) => l.member_id);
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

      const entries = links.flatMap((l) => {
        const member = membersById.get(l.member_id);
        return member ? [{ member, role: l.role }] : [];
      });

      return reply.code(200).send({ group, children: childrenRes.data ?? [], members: entries });
    },
  );

  /** Partially update a group, including reparenting (cycle-checked). */
  r.patch(
    "/groups/:id",
    {
      onRequest: [app.authenticate, requirePermission("groups.write")],
      schema: {
        tags: ["groups"],
        summary: "Update a group",
        description:
          "Partially updates a group; reparenting is rejected if it would form a cycle. Requires groups.write.",
        security: [{ bearerAuth: [] }],
        params: groupIdParamsZ,
        body: updateGroupBodyZ,
        response: {
          200: z.object({ group: groupZ, message: z.string() }),
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

      // Reparenting: the new parent must exist in this church and must not be the
      // group itself or one of its descendants (which would create a cycle).
      if (req.body.parentId) {
        if (req.body.parentId === req.params.id) {
          return reply.code(400).send({
            error: "InvalidParent",
            message: "A group cannot be its own parent.",
          });
        }
        const { data: parent, error: parentErr } = await supabase
          .from("groups")
          .select("id")
          .eq("church_id", auth.churchId)
          .eq("id", req.body.parentId)
          .maybeSingle();
        if (parentErr) {
          req.log.error({ err: parentErr }, "group parent lookup failed");
          return reply.code(500).send({
            error: "UpdateFailed",
            message: "Could not update the group. Please try again.",
          });
        }
        if (!parent) {
          return reply.code(404).send({
            error: "ParentNotFound",
            message: "No parent group exists with that id in this church.",
          });
        }
        if (await wouldCreateCycle(supabase, auth.churchId, req.params.id, req.body.parentId)) {
          return reply.code(400).send({
            error: "CyclicParent",
            message: "That parent would create a cycle in the group hierarchy.",
          });
        }
      }

      const patch: Database["public"]["Tables"]["groups"]["Update"] = {
        name: req.body.name,
        group_type: req.body.groupType,
        parent_id: req.body.parentId,
        description: req.body.description,
      };

      const { data, error } = await supabase
        .from("groups")
        .update(patch)
        .eq("church_id", auth.churchId)
        .eq("id", req.params.id)
        .select("*")
        .maybeSingle();

      if (error) {
        req.log.error({ err: error }, "group update failed");
        return reply.code(500).send({
          error: "UpdateFailed",
          message: "Could not update the group. Please try again.",
        });
      }
      if (!data) {
        return reply.code(404).send({
          error: "GroupNotFound",
          message: "No group exists with that id in this church.",
        });
      }

      void syncGroupToIndex(data, req.log);
      return reply.code(200).send({ group: data, message: "Group updated." });
    },
  );

  /** Delete a group and its entire subtree (children + memberships cascade). */
  r.delete(
    "/groups/:id",
    {
      onRequest: [app.authenticate, requirePermission("groups.write")],
      schema: {
        tags: ["groups"],
        summary: "Delete a group",
        description:
          "Deletes a group and everything beneath it (child groups and memberships cascade). Requires groups.write.",
        security: [{ bearerAuth: [] }],
        params: groupIdParamsZ,
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
        .from("groups")
        .delete()
        .eq("church_id", auth.churchId)
        .eq("id", req.params.id)
        .select("id");

      if (error) {
        req.log.error({ err: error }, "group delete failed");
        return reply.code(500).send({
          error: "DeleteFailed",
          message: "Could not delete the group. Please try again.",
        });
      }
      if (!data || data.length === 0) {
        return reply.code(404).send({
          error: "GroupNotFound",
          message: "No group exists with that id in this church.",
        });
      }

      void removeGroupFromIndex(req.params.id, req.log);
      return reply.code(200).send({ message: "Group deleted." });
    },
  );

  /** Assign a member to a group; logs a group_join on the member's timeline. */
  r.post(
    "/groups/:id/members",
    {
      onRequest: [app.authenticate, requirePermission("groups.write")],
      schema: {
        tags: ["groups"],
        summary: "Assign a member to a group",
        description:
          "Adds a member to a group (optional role) and logs a group_join. Requires groups.write.",
        security: [{ bearerAuth: [] }],
        params: groupIdParamsZ,
        body: assignMemberBodyZ,
        response: {
          201: z.object({ assignment: groupMemberLinkZ, message: z.string() }),
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

      const [groupRes, memberRes] = await Promise.all([
        supabase
          .from("groups")
          .select("id, name")
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

      if (groupRes.error || memberRes.error) {
        req.log.error({ err: groupRes.error ?? memberRes.error }, "group assign lookup failed");
        return reply.code(500).send({
          error: "AssignFailed",
          message: "Could not assign the member. Please try again.",
        });
      }
      if (!groupRes.data) {
        return reply.code(404).send({
          error: "GroupNotFound",
          message: "No group exists with that id in this church.",
        });
      }
      if (!memberRes.data) {
        return reply.code(404).send({
          error: "MemberNotFound",
          message: "No active member exists with that id in this church.",
        });
      }

      const { data, error } = await supabase
        .from("group_members")
        .insert({
          group_id: req.params.id,
          member_id: req.body.memberId,
          church_id: auth.churchId,
          role: req.body.role,
          created_by: auth.userId,
        })
        .select("group_id, member_id, role, created_at")
        .single();

      if (error || !data) {
        if (error?.code === PG_UNIQUE_VIOLATION) {
          return reply.code(409).send({
            error: "AlreadyAssigned",
            message: "That member is already in this group.",
          });
        }
        req.log.error({ err: error }, "group assign insert failed");
        return reply.code(500).send({
          error: "AssignFailed",
          message: "Could not assign the member. Please try again.",
        });
      }

      await logMemberEvent(
        supabase,
        {
          churchId: auth.churchId,
          memberId: req.body.memberId,
          eventType: "group_join",
          metadata: { group_id: req.params.id, group_name: groupRes.data.name, role: data.role },
          createdBy: auth.userId,
        },
        req.log,
      );

      return reply.code(201).send({ assignment: data, message: "Member assigned to group." });
    },
  );

  /** Remove a member from a group; logs a group_leave on the member's timeline. */
  r.delete(
    "/groups/:id/members/:memberId",
    {
      onRequest: [app.authenticate, requirePermission("groups.write")],
      schema: {
        tags: ["groups"],
        summary: "Remove a member from a group",
        description: "Removes a member from a group and logs a group_leave. Requires groups.write.",
        security: [{ bearerAuth: [] }],
        params: unassignParamsZ,
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
        .from("group_members")
        .delete()
        .eq("church_id", auth.churchId)
        .eq("group_id", req.params.id)
        .eq("member_id", req.params.memberId)
        .select("member_id");

      if (error) {
        req.log.error({ err: error }, "group unassign failed");
        return reply.code(500).send({
          error: "RemoveFailed",
          message: "Could not remove the member. Please try again.",
        });
      }
      if (!data || data.length === 0) {
        return reply.code(404).send({
          error: "AssignmentNotFound",
          message: "That member is not in this group.",
        });
      }

      await logMemberEvent(
        supabase,
        {
          churchId: auth.churchId,
          memberId: req.params.memberId,
          eventType: "group_leave",
          metadata: { group_id: req.params.id },
          createdBy: auth.userId,
        },
        req.log,
      );

      return reply.code(200).send({ message: "Member removed from group." });
    },
  );

  /**
   * Full-text group search via Meilisearch (typo-tolerant, scoped to the caller's
   * church). Returns 503 when search isn't configured or is down; the plain list
   * (GET /groups with its ilike `search`) remains the always-available path.
   */
  r.get(
    "/groups/search",
    {
      onRequest: [app.authenticate, requirePermission("groups.read")],
      schema: {
        tags: ["groups"],
        summary: "Search groups",
        description:
          "Typo-tolerant full-text search of the caller's church groups. Requires groups.read.",
        security: [{ bearerAuth: [] }],
        querystring: groupSearchQueryZ,
        response: {
          200: z.object({
            query: z.string(),
            hits: z.array(groupSearchHitZ),
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
        const result = await searchGroups(auth.churchId, q, { limit: pageSize, offset });
        return reply.code(200).send({
          query: q,
          hits: result.hits,
          estimatedTotalHits: result.estimatedTotalHits,
          limit: result.limit,
          offset: result.offset,
        });
      } catch (err) {
        req.log.error({ err }, "group search failed");
        return reply.code(503).send({
          error: "SearchUnavailable",
          message: "Search is temporarily unavailable. Please try again.",
        });
      }
    },
  );
}
