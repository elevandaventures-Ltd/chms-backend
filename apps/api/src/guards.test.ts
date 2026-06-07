import { describe, expect, it, afterAll } from "vitest";
import { SignJWT } from "jose";
import type { FastifyReply, FastifyRequest } from "fastify";
import {
  ROLE_PERMISSIONS,
  type PermissionKey,
  type UserRole,
} from "@repo/api-types";
import { buildApp } from "./app.js";
import { requirePermission, requireRole } from "./guards.js";
import type { AuthContext } from "./plugins/auth.js";

// ---------------------------------------------------------------------------
// Unit-level guard tests: drive the guards directly with a fake request/reply
// so the role→permission decision is verified without HTTP or a DB. The route
// matrix further down proves the same guards are actually wired to the routes.
// ---------------------------------------------------------------------------

/** A reply double that records the status code and payload a guard sends. */
function mockReply(): FastifyReply & { statusCode: number; payload: unknown } {
  const reply = {
    statusCode: 0,
    payload: undefined as unknown,
    code(this: { statusCode: number }, c: number) {
      this.statusCode = c;
      return this;
    },
    send(this: { payload: unknown }, p: unknown) {
      this.payload = p;
      return this;
    },
  };
  return reply as unknown as FastifyReply & { statusCode: number; payload: unknown };
}

function mockReq(auth: AuthContext | null): FastifyRequest {
  return { auth } as FastifyRequest;
}

const ALL_PERMISSIONS: PermissionKey[] = [
  "members.read",
  "members.write",
  "members.delete",
  "groups.read",
  "groups.write",
  "events.read",
  "events.write",
  "finances.read",
  "finances.write",
  "reports.read",
  "roles.read",
  "roles.assign",
  "church.manage",
];

const ALL_ROLES = Object.keys(ROLE_PERMISSIONS) as UserRole[];

const CHURCH_ID = "11111111-1111-1111-1111-111111111111";

function authFor(role: UserRole | null, churchId: string | null = CHURCH_ID): AuthContext {
  return { userId: "user-1", email: "u@example.com", churchId, role };
}

describe("requirePermission (unit)", () => {
  it("replies 401 when the request is unauthenticated", async () => {
    const reply = mockReply();
    await requirePermission("roles.read")(mockReq(null), reply);
    expect(reply.statusCode).toBe(401);
    expect(reply.payload).toMatchObject({ error: "Unauthorized" });
  });

  it("replies 403 NoChurchContext when the session has no church", async () => {
    const reply = mockReply();
    await requirePermission("roles.read")(mockReq(authFor("owner", null)), reply);
    expect(reply.statusCode).toBe(403);
    expect(reply.payload).toMatchObject({ error: "NoChurchContext" });
  });

  it("replies 403 Forbidden when the role lacks the permission", async () => {
    const reply = mockReply();
    await requirePermission("roles.assign")(mockReq(authFor("member")), reply);
    expect(reply.statusCode).toBe(403);
    expect(reply.payload).toMatchObject({ error: "Forbidden" });
  });

  it("passes through (sends nothing) when the role holds the permission", async () => {
    const reply = mockReply();
    await requirePermission("roles.assign")(mockReq(authFor("owner")), reply);
    expect(reply.statusCode).toBe(0);
    expect(reply.payload).toBeUndefined();
  });

  it("requires ALL listed permissions, not just one", async () => {
    const reply = mockReply();
    // finance_officer has finances.read but not roles.read.
    await requirePermission("finances.read", "roles.read")(
      mockReq(authFor("finance_officer")),
      reply,
    );
    expect(reply.statusCode).toBe(403);
  });

  // The exhaustive policy matrix: every role against every permission. This is
  // the machine-checkable statement of "each role can only do what it may do",
  // and locks the guard to the ROLE_PERMISSIONS catalog (the migration mirror).
  describe("role × permission matrix", () => {
    for (const role of ALL_ROLES) {
      for (const permission of ALL_PERMISSIONS) {
        const allowed = ROLE_PERMISSIONS[role].includes(permission);
        it(`${role} ${allowed ? "may" : "may NOT"} ${permission}`, async () => {
          const reply = mockReply();
          await requirePermission(permission)(mockReq(authFor(role)), reply);
          if (allowed) {
            expect(reply.statusCode).toBe(0);
          } else {
            expect(reply.statusCode).toBe(403);
            expect(reply.payload).toMatchObject({ error: "Forbidden" });
          }
        });
      }
    }
  });
});

describe("requireRole (unit)", () => {
  it("replies 401 when unauthenticated", async () => {
    const reply = mockReply();
    await requireRole("owner")(mockReq(null), reply);
    expect(reply.statusCode).toBe(401);
  });

  it("replies 403 NoChurchContext without a church scope", async () => {
    const reply = mockReply();
    await requireRole("owner")(mockReq(authFor("owner", null)), reply);
    expect(reply.statusCode).toBe(403);
    expect(reply.payload).toMatchObject({ error: "NoChurchContext" });
  });

  it("forbids a role outside the allowed set", async () => {
    const reply = mockReply();
    await requireRole("owner", "admin")(mockReq(authFor("member")), reply);
    expect(reply.statusCode).toBe(403);
    expect(reply.payload).toMatchObject({ error: "Forbidden" });
  });

  it("allows a role inside the allowed set", async () => {
    const reply = mockReply();
    await requireRole("owner", "admin")(mockReq(authFor("admin")), reply);
    expect(reply.statusCode).toBe(0);
  });
});

// ---------------------------------------------------------------------------
// Route-level matrix: prove the guards gate the real endpoints, per role.
//
// Hermetic trick: guards run in `onRequest`, BEFORE body validation, which runs
// before the handler (and its DB call). So for POST /role-assignments we send a
// deliberately invalid body and read the status to tell authz from validation:
//   * a role WITH roles.assign  → guard passes → body validation fails → 400
//   * a role WITHOUT it         → guard rejects first                  → 403
// This exercises both the allow and deny paths without a live Supabase.
// ---------------------------------------------------------------------------

const app = buildApp();

afterAll(async () => {
  await app.close();
});

function signTestToken(claims: Record<string, unknown>): Promise<string> {
  const secret = new TextEncoder().encode(process.env.SUPABASE_JWT_SECRET);
  return new SignJWT(claims)
    .setProtectedHeader({ alg: "HS256", typ: "JWT" })
    .setAudience("authenticated")
    .setIssuedAt()
    .setExpirationTime("1h")
    .sign(secret);
}

function tokenForRole(role: UserRole): Promise<string> {
  return signTestToken({
    sub: `user-${role}`,
    role: "authenticated",
    church_id: CHURCH_ID,
    user_role: role,
  });
}

describe("role-based access to /role-assignments", () => {
  describe("POST (requires roles.assign)", () => {
    for (const role of ALL_ROLES) {
      const canAssign = ROLE_PERMISSIONS[role].includes("roles.assign");
      it(`${role} is ${canAssign ? "allowed past authz" : "forbidden"}`, async () => {
        const token = await tokenForRole(role);
        const res = await app.inject({
          method: "POST",
          url: "/role-assignments",
          headers: { authorization: `Bearer ${token}` },
          // Intentionally invalid (missing roleKey): a permitted caller reaches
          // body validation (400); a forbidden caller is stopped earlier (403).
          payload: { userId: "not-a-uuid" },
        });
        if (canAssign) {
          expect(res.statusCode).toBe(400);
        } else {
          expect(res.statusCode).toBe(403);
          expect(res.json()).toMatchObject({ error: "Forbidden" });
        }
      });
    }
  });

  describe("GET (requires roles.read)", () => {
    for (const role of ALL_ROLES) {
      const canRead = ROLE_PERMISSIONS[role].includes("roles.read");
      // Only assert the deny side at the route level: a permitted caller would
      // fall through to a live DB query (covered by the integration suite).
      if (canRead) continue;
      it(`${role} is forbidden`, async () => {
        const token = await tokenForRole(role);
        const res = await app.inject({
          method: "GET",
          url: "/role-assignments",
          headers: { authorization: `Bearer ${token}` },
        });
        expect(res.statusCode).toBe(403);
        expect(res.json()).toMatchObject({ error: "Forbidden" });
      });
    }
  });

  it("rejects an unauthenticated caller with 401", async () => {
    const res = await app.inject({ method: "GET", url: "/role-assignments" });
    expect(res.statusCode).toBe(401);
    expect(res.json()).toMatchObject({ error: "Unauthorized" });
  });

  it("rejects a caller with no church scope with 403 NoChurchContext", async () => {
    const token = await signTestToken({
      sub: "u1",
      role: "authenticated",
      user_role: "owner",
    });
    const res = await app.inject({
      method: "GET",
      url: "/role-assignments",
      headers: { authorization: `Bearer ${token}` },
    });
    expect(res.statusCode).toBe(403);
    expect(res.json()).toMatchObject({ error: "NoChurchContext" });
  });
});
