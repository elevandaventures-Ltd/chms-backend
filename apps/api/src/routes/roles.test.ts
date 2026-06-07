import { describe, expect, it, afterAll } from "vitest";
import { SignJWT } from "jose";
import { buildApp } from "../app.js";

const app = buildApp();

afterAll(async () => {
  await app.close();
});

// HS256 tokens signed with the test secret get past authenticate() without a
// live Supabase project. Every case here asserts behaviour that resolves BEFORE
// any DB call (auth, schema validation, owner/admin authz), so the suite stays
// hermetic; the happy path belongs in an integration test against a real stack.
function signTestToken(claims: Record<string, unknown>): Promise<string> {
  const secret = new TextEncoder().encode(process.env.SUPABASE_JWT_SECRET);
  return new SignJWT(claims)
    .setProtectedHeader({ alg: "HS256", typ: "JWT" })
    .setAudience("authenticated")
    .setIssuedAt()
    .setExpirationTime("1h")
    .sign(secret);
}

function authedHeaders(token: string): Record<string, string> {
  return { authorization: `Bearer ${token}` };
}

const CHURCH_ID = "11111111-1111-1111-1111-111111111111";
const TARGET_USER = "22222222-2222-2222-2222-222222222222";

// A caller who can manage roles: owner of a church.
function ownerClaims(): Record<string, unknown> {
  return { sub: "owner-1", role: "authenticated", church_id: CHURCH_ID, user_role: "owner" };
}

describe("POST /role-assignments", () => {
  it("rejects an unauthenticated request", async () => {
    const res = await app.inject({
      method: "POST",
      url: "/role-assignments",
      payload: { userId: TARGET_USER, roleKey: "admin_staff" },
    });
    expect(res.statusCode).toBe(401);
    expect(res.json()).toMatchObject({ error: "Unauthorized" });
  });

  it("rejects a caller with no church context", async () => {
    const token = await signTestToken({ sub: "u1", role: "authenticated" });
    const res = await app.inject({
      method: "POST",
      url: "/role-assignments",
      headers: authedHeaders(token),
      payload: { userId: TARGET_USER, roleKey: "admin_staff" },
    });
    expect(res.statusCode).toBe(403);
    expect(res.json()).toMatchObject({ error: "NoChurchContext" });
  });

  it("forbids a non-manager role from assigning", async () => {
    const token = await signTestToken({
      sub: "u1",
      role: "authenticated",
      church_id: CHURCH_ID,
      user_role: "member",
    });
    const res = await app.inject({
      method: "POST",
      url: "/role-assignments",
      headers: authedHeaders(token),
      payload: { userId: TARGET_USER, roleKey: "admin_staff" },
    });
    expect(res.statusCode).toBe(403);
    expect(res.json()).toMatchObject({ error: "Forbidden" });
  });

  it("rejects a body missing required fields", async () => {
    const token = await signTestToken(ownerClaims());
    const res = await app.inject({
      method: "POST",
      url: "/role-assignments",
      headers: authedHeaders(token),
      payload: { userId: TARGET_USER },
    });
    expect(res.statusCode).toBe(400);
  });

  it("rejects unknown body properties", async () => {
    const token = await signTestToken(ownerClaims());
    const res = await app.inject({
      method: "POST",
      url: "/role-assignments",
      headers: authedHeaders(token),
      payload: { userId: TARGET_USER, roleKey: "admin_staff", churchId: CHURCH_ID },
    });
    expect(res.statusCode).toBe(400);
  });

  it("rejects an unknown role key", async () => {
    const token = await signTestToken(ownerClaims());
    const res = await app.inject({
      method: "POST",
      url: "/role-assignments",
      headers: authedHeaders(token),
      payload: { userId: TARGET_USER, roleKey: "superuser" },
    });
    expect(res.statusCode).toBe(400);
  });

  it("rejects a non-uuid userId", async () => {
    const token = await signTestToken(ownerClaims());
    const res = await app.inject({
      method: "POST",
      url: "/role-assignments",
      headers: authedHeaders(token),
      payload: { userId: "not-a-uuid", roleKey: "admin_staff" },
    });
    expect(res.statusCode).toBe(400);
  });
});

describe("DELETE /role-assignments/:userId/:roleKey", () => {
  it("rejects an unauthenticated request", async () => {
    const res = await app.inject({
      method: "DELETE",
      url: `/role-assignments/${TARGET_USER}/admin_staff`,
    });
    expect(res.statusCode).toBe(401);
  });

  it("forbids a non-manager role from removing", async () => {
    const token = await signTestToken({
      sub: "u1",
      role: "authenticated",
      church_id: CHURCH_ID,
      user_role: "ministry_leader",
    });
    const res = await app.inject({
      method: "DELETE",
      url: `/role-assignments/${TARGET_USER}/admin_staff`,
      headers: authedHeaders(token),
    });
    expect(res.statusCode).toBe(403);
    expect(res.json()).toMatchObject({ error: "Forbidden" });
  });

  it("rejects an unknown role key in the path", async () => {
    const token = await signTestToken(ownerClaims());
    const res = await app.inject({
      method: "DELETE",
      url: `/role-assignments/${TARGET_USER}/superuser`,
      headers: authedHeaders(token),
    });
    expect(res.statusCode).toBe(400);
  });

  it("rejects a non-uuid userId in the path", async () => {
    const token = await signTestToken(ownerClaims());
    const res = await app.inject({
      method: "DELETE",
      url: `/role-assignments/not-a-uuid/admin_staff`,
      headers: authedHeaders(token),
    });
    expect(res.statusCode).toBe(400);
  });
});

describe("GET /role-assignments", () => {
  it("rejects an unauthenticated request", async () => {
    const res = await app.inject({ method: "GET", url: "/role-assignments" });
    expect(res.statusCode).toBe(401);
  });

  it("forbids a non-manager role from listing", async () => {
    const token = await signTestToken({
      sub: "u1",
      role: "authenticated",
      church_id: CHURCH_ID,
      user_role: "finance_officer",
    });
    const res = await app.inject({
      method: "GET",
      url: "/role-assignments",
      headers: authedHeaders(token),
    });
    expect(res.statusCode).toBe(403);
    expect(res.json()).toMatchObject({ error: "Forbidden" });
  });
});
