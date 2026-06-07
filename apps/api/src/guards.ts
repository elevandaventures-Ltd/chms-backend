import type { FastifyReply, FastifyRequest } from "fastify";
import {
  ROLE_PERMISSIONS,
  type PermissionKey,
  type UserRole,
} from "@repo/api-types";
import type { AuthContext } from "./plugins/auth.js";

/**
 * Role/permission authorisation guards, expressed as Fastify `onRequest` hook
 * factories so a route can declare its access policy inline:
 *
 *   app.get("/role-assignments",
 *     { onRequest: [app.authenticate, requirePermission("roles.read")] },
 *     handler);
 *
 * They run AFTER `app.authenticate` (which populates `req.auth`) and short
 * circuit the request with the appropriate status before the handler runs:
 *   401 Unauthorized   — no/invalid bearer token (auth never ran or set null)
 *   403 NoChurchContext — authenticated but the session isn't scoped to a church
 *   403 Forbidden      — authenticated + scoped, but the role lacks the role/perm
 *
 * Authorisation is decided purely from the JWT `user_role` claim against the
 * static {@link ROLE_PERMISSIONS} mirror — no per-request DB lookup — matching
 * how the rest of the auth path reads identity straight off the token.
 */

type Guard = (req: FastifyRequest, reply: FastifyReply) => Promise<void>;

/** An auth context proven to carry a church scope. */
export type ChurchScopedAuth = AuthContext & { churchId: string };

function unauthorized(reply: FastifyReply): void {
  reply.code(401).send({ error: "Unauthorized", message: "Missing bearer token" });
}

function noChurchContext(reply: FastifyReply): void {
  reply.code(403).send({
    error: "NoChurchContext",
    message: "Your session is not scoped to a church.",
  });
}

function forbidden(reply: FastifyReply, message: string): void {
  reply.code(403).send({ error: "Forbidden", message });
}

/**
 * Narrow `req.auth` to a church-scoped context inside a handler that sits behind
 * a guard. The guard already guaranteed both are present, so this only re-checks
 * to satisfy the type system (and stays defensive if a route forgets the guard).
 * Returns null after sending the matching error — callers must stop on null.
 */
export function requireChurchScopedAuth(
  req: FastifyRequest,
  reply: FastifyReply,
): ChurchScopedAuth | null {
  const auth = req.auth;
  if (!auth) {
    unauthorized(reply);
    return null;
  }
  if (!auth.churchId) {
    noChurchContext(reply);
    return null;
  }
  return { ...auth, churchId: auth.churchId };
}

/**
 * Guard: the caller must be authenticated, scoped to a church, and hold one of
 * `allowed` roles. Prefer {@link requirePermission} for capability checks; reach
 * for this only when a route truly cares about the role identity itself.
 */
export function requireRole(...allowed: UserRole[]): Guard {
  return async (req, reply) => {
    const auth = req.auth;
    if (!auth) return unauthorized(reply);
    if (!auth.churchId) return noChurchContext(reply);
    if (!auth.role || !allowed.includes(auth.role)) {
      return forbidden(
        reply,
        `This action requires one of these roles: ${allowed.join(", ")}.`,
      );
    }
  };
}

/**
 * Guard: the caller must be authenticated, scoped to a church, and their role
 * must grant every one of `required` permissions.
 */
export function requirePermission(...required: PermissionKey[]): Guard {
  return async (req, reply) => {
    const auth = req.auth;
    if (!auth) return unauthorized(reply);
    if (!auth.churchId) return noChurchContext(reply);

    const granted: readonly PermissionKey[] = auth.role
      ? ROLE_PERMISSIONS[auth.role]
      : [];
    const missing = required.filter((p) => !granted.includes(p));
    if (missing.length > 0) {
      return forbidden(
        reply,
        `You do not have permission to perform this action (requires: ${missing.join(", ")}).`,
      );
    }
  };
}
