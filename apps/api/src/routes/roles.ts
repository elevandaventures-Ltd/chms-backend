import type { FastifyInstance } from "fastify";
import { createSupabaseAdminClient } from "@repo/db";
import type {
  AssignRoleRequest,
  AssignRoleResponse,
  ListRoleAssignmentsResponse,
  RemoveRoleResponse,
  RoleAssignment,
  UserRole,
} from "@repo/api-types";
import { requireChurchScopedAuth, requirePermission } from "../guards.js";

// The seeded role catalog (migration 20260604160000). Kept in lockstep with the
// user_role enum; used to constrain request bodies via ajv `enum`.
const ROLE_KEYS: UserRole[] = [
  "owner",
  "admin",
  "senior_pastor",
  "admin_staff",
  "ministry_leader",
  "finance_officer",
  "member",
];

// Fastify's bundled ajv has no named string formats, so uuid is a pattern.
const UUID_PATTERN =
  "^[0-9a-fA-F]{8}-[0-9a-fA-F]{4}-[0-9a-fA-F]{4}-[0-9a-fA-F]{4}-[0-9a-fA-F]{12}$";

// Postgres unique_violation — surfaced by supabase-js as error.code.
const PG_UNIQUE_VIOLATION = "23505";

const assignRoleSchema = {
  type: "object",
  required: ["userId", "roleKey"],
  additionalProperties: false,
  properties: {
    userId: { type: "string", pattern: UUID_PATTERN },
    roleKey: { type: "string", enum: ROLE_KEYS },
  },
} as const;

const removeRoleParamsSchema = {
  type: "object",
  required: ["userId", "roleKey"],
  additionalProperties: false,
  properties: {
    userId: { type: "string", pattern: UUID_PATTERN },
    roleKey: { type: "string", enum: ROLE_KEYS },
  },
} as const;

export async function rolesRoutes(app: FastifyInstance): Promise<void> {
  /**
   * Assign a role to a member of the caller's church. The church is taken from
   * the caller's JWT, never the body, so a caller can only ever assign within
   * their own tenant. Authorisation (the `roles.assign` permission) is enforced
   * by the requirePermission guard; the write then goes through the service_role
   * key (the established mutation pattern).
   */
  app.post(
    "/role-assignments",
    {
      onRequest: [app.authenticate, requirePermission("roles.assign")],
      schema: { body: assignRoleSchema },
    },
    async (req, reply) => {
      const auth = requireChurchScopedAuth(req, reply);
      if (!auth) return reply;

      const { userId, roleKey } = req.body as AssignRoleRequest;
      const supabase = createSupabaseAdminClient();

      // Resolve the role key to its catalog id (and friendly name for the reply).
      const { data: role, error: roleErr } = await supabase
        .from("roles")
        .select("id, key, name")
        .eq("key", roleKey)
        .single();

      if (roleErr || !role) {
        req.log.error({ err: roleErr, roleKey }, "role lookup failed");
        return reply.code(400).send({
          error: "UnknownRole",
          message: `Role "${roleKey}" is not in the catalog.`,
        });
      }

      // The target must be a real user before we hand them a role.
      const { data: targetUser, error: userErr } = await supabase
        .from("users")
        .select("id")
        .eq("id", userId)
        .maybeSingle();

      if (userErr) {
        req.log.error({ err: userErr }, "target user lookup failed");
        return reply.code(500).send({
          error: "AssignmentFailed",
          message: "Could not assign the role. Please try again.",
        });
      }
      if (!targetUser) {
        return reply.code(404).send({
          error: "UserNotFound",
          message: "No user exists with that id.",
        });
      }

      const { data: inserted, error: insertErr } = await supabase
        .from("user_church_roles")
        .insert({
          user_id: userId,
          church_id: auth.churchId,
          role_id: role.id,
          assigned_by: auth.userId,
        })
        .select("id, user_id, church_id, assigned_by, created_at")
        .single();

      if (insertErr || !inserted) {
        if (insertErr?.code === PG_UNIQUE_VIOLATION) {
          return reply.code(409).send({
            error: "RoleAlreadyAssigned",
            message: `That user already holds the "${roleKey}" role in this church.`,
          });
        }
        req.log.error({ err: insertErr }, "role assignment insert failed");
        return reply.code(500).send({
          error: "AssignmentFailed",
          message: "Could not assign the role. Please try again.",
        });
      }

      const assignment: RoleAssignment = {
        id: inserted.id,
        userId: inserted.user_id,
        churchId: inserted.church_id,
        roleKey: role.key,
        roleName: role.name,
        assignedBy: inserted.assigned_by,
        createdAt: inserted.created_at,
      };
      const response: AssignRoleResponse = {
        assignment,
        message: `Assigned "${role.name}" to the member.`,
      };
      return reply.code(201).send(response);
    },
  );

  /**
   * Remove a specific role from a member of the caller's church. Idempotent from
   * the client's view except that removing a role that isn't assigned returns
   * 404 so the caller can tell the difference.
   */
  app.delete(
    "/role-assignments/:userId/:roleKey",
    {
      onRequest: [app.authenticate, requirePermission("roles.assign")],
      schema: { params: removeRoleParamsSchema },
    },
    async (req, reply) => {
      const auth = requireChurchScopedAuth(req, reply);
      if (!auth) return reply;

      const { userId, roleKey } = req.params as { userId: string; roleKey: UserRole };
      const supabase = createSupabaseAdminClient();

      const { data: role, error: roleErr } = await supabase
        .from("roles")
        .select("id")
        .eq("key", roleKey)
        .single();

      if (roleErr || !role) {
        req.log.error({ err: roleErr, roleKey }, "role lookup failed");
        return reply.code(400).send({
          error: "UnknownRole",
          message: `Role "${roleKey}" is not in the catalog.`,
        });
      }

      const { data: deleted, error: deleteErr } = await supabase
        .from("user_church_roles")
        .delete()
        .eq("user_id", userId)
        .eq("church_id", auth.churchId)
        .eq("role_id", role.id)
        .select("id");

      if (deleteErr) {
        req.log.error({ err: deleteErr }, "role assignment delete failed");
        return reply.code(500).send({
          error: "RemovalFailed",
          message: "Could not remove the role. Please try again.",
        });
      }
      if (!deleted || deleted.length === 0) {
        return reply.code(404).send({
          error: "AssignmentNotFound",
          message: `That user does not hold the "${roleKey}" role in this church.`,
        });
      }

      const response: RemoveRoleResponse = { message: `Removed the "${roleKey}" role.` };
      return reply.code(200).send(response);
    },
  );

  /**
   * List every role assignment in the caller's church. Role keys/names are
   * resolved in-process from the catalog so the response is self-describing
   * without a SQL join.
   */
  app.get(
    "/role-assignments",
    { onRequest: [app.authenticate, requirePermission("roles.read")] },
    async (req, reply) => {
      const auth = requireChurchScopedAuth(req, reply);
      if (!auth) return reply;

      const supabase = createSupabaseAdminClient();

      const [assignmentsRes, rolesRes] = await Promise.all([
        supabase
          .from("user_church_roles")
          .select("id, user_id, church_id, role_id, assigned_by, created_at")
          .eq("church_id", auth.churchId)
          .order("created_at", { ascending: true }),
        supabase.from("roles").select("id, key, name"),
      ]);

      if (assignmentsRes.error || rolesRes.error) {
        req.log.error(
          { err: assignmentsRes.error ?? rolesRes.error },
          "listing role assignments failed",
        );
        return reply.code(500).send({
          error: "ListFailed",
          message: "Could not list role assignments. Please try again.",
        });
      }

      const roleById = new Map(rolesRes.data.map((r) => [r.id, r]));
      const assignments: RoleAssignment[] = assignmentsRes.data.map((a) => {
        const role = roleById.get(a.role_id);
        return {
          id: a.id,
          userId: a.user_id,
          churchId: a.church_id,
          roleKey: (role?.key ?? "member") as UserRole,
          roleName: role?.name ?? "Unknown",
          assignedBy: a.assigned_by,
          createdAt: a.created_at,
        };
      });

      const response: ListRoleAssignmentsResponse = { assignments };
      return reply.code(200).send(response);
    },
  );
}
