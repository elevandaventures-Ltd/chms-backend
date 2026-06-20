import { describe, expect, it, afterAll } from "vitest";
import { SignJWT } from "jose";
import { buildApp } from "../app.js";

const app = buildApp();

afterAll(async () => {
  await app.close();
});

const CHURCH_ID = "11111111-1111-1111-1111-111111111111";

// Mint an HS256 token with the test secret so requests get past authenticate()
// without a live Supabase project. Like churches.test.ts, every case here
// asserts behaviour that resolves BEFORE the DB call (auth, authz, validation),
// so the suite stays hermetic; the happy paths are integration-tested.
function signToken(claims: Record<string, unknown>): Promise<string> {
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

// owner grants members.read/write/delete; finance_officer grants neither write.
function ownerToken(): Promise<string> {
  return signToken({ sub: "owner-1", church_id: CHURCH_ID, user_role: "owner" });
}
function financeToken(): Promise<string> {
  return signToken({ sub: "fin-1", church_id: CHURCH_ID, user_role: "finance_officer" });
}

describe("POST /members", () => {
  it("rejects an unauthenticated request", async () => {
    const res = await app.inject({
      method: "POST",
      url: "/members",
      payload: { firstName: "Jane" },
    });
    expect(res.statusCode).toBe(401);
    expect(res.json()).toMatchObject({ error: "Unauthorized" });
  });

  it("forbids a role without members.write", async () => {
    const token = await financeToken();
    const res = await app.inject({
      method: "POST",
      url: "/members",
      headers: authedHeaders(token),
      payload: { firstName: "Jane" },
    });
    expect(res.statusCode).toBe(403);
  });

  it("rejects a session with no church scope", async () => {
    const token = await signToken({ sub: "u1", user_role: "owner" });
    const res = await app.inject({
      method: "POST",
      url: "/members",
      headers: authedHeaders(token),
      payload: { firstName: "Jane" },
    });
    expect(res.statusCode).toBe(403);
    expect(res.json()).toMatchObject({ error: "NoChurchContext" });
  });

  it("rejects a body missing the required firstName", async () => {
    const token = await ownerToken();
    const res = await app.inject({
      method: "POST",
      url: "/members",
      headers: authedHeaders(token),
      payload: {},
    });
    expect(res.statusCode).toBe(400);
  });

  it("rejects unknown body properties (strict)", async () => {
    const token = await ownerToken();
    const res = await app.inject({
      method: "POST",
      url: "/members",
      headers: authedHeaders(token),
      payload: { firstName: "Jane", isAdmin: true },
    });
    expect(res.statusCode).toBe(400);
  });

  it("rejects a malformed email", async () => {
    const token = await ownerToken();
    const res = await app.inject({
      method: "POST",
      url: "/members",
      headers: authedHeaders(token),
      payload: { firstName: "Jane", email: "not-an-email" },
    });
    expect(res.statusCode).toBe(400);
  });

  it("rejects an invalid status enum", async () => {
    const token = await ownerToken();
    const res = await app.inject({
      method: "POST",
      url: "/members",
      headers: authedHeaders(token),
      payload: { firstName: "Jane", status: "vip" },
    });
    expect(res.statusCode).toBe(400);
  });
});

describe("GET /members", () => {
  it("rejects an unauthenticated request", async () => {
    const res = await app.inject({ method: "GET", url: "/members" });
    expect(res.statusCode).toBe(401);
  });

  it("rejects an invalid status filter", async () => {
    const token = await ownerToken();
    const res = await app.inject({
      method: "GET",
      url: "/members?status=bogus",
      headers: authedHeaders(token),
    });
    expect(res.statusCode).toBe(400);
  });

  it("rejects a pageSize over the cap", async () => {
    const token = await ownerToken();
    const res = await app.inject({
      method: "GET",
      url: "/members?pageSize=500",
      headers: authedHeaders(token),
    });
    expect(res.statusCode).toBe(400);
  });
});

describe("GET /members/:id", () => {
  it("rejects an unauthenticated request", async () => {
    const res = await app.inject({
      method: "GET",
      url: `/members/${CHURCH_ID}`,
    });
    expect(res.statusCode).toBe(401);
  });

  it("rejects a non-uuid id", async () => {
    const token = await ownerToken();
    const res = await app.inject({
      method: "GET",
      url: "/members/not-a-uuid",
      headers: authedHeaders(token),
    });
    expect(res.statusCode).toBe(400);
  });
});

describe("PATCH /members/:id", () => {
  it("rejects an unauthenticated request", async () => {
    const res = await app.inject({
      method: "PATCH",
      url: `/members/${CHURCH_ID}`,
      payload: { firstName: "Jane" },
    });
    expect(res.statusCode).toBe(401);
  });

  it("forbids a role without members.write", async () => {
    const token = await financeToken();
    const res = await app.inject({
      method: "PATCH",
      url: `/members/${CHURCH_ID}`,
      headers: authedHeaders(token),
      payload: { firstName: "Jane" },
    });
    expect(res.statusCode).toBe(403);
  });

  it("rejects an empty patch", async () => {
    const token = await ownerToken();
    const res = await app.inject({
      method: "PATCH",
      url: `/members/${CHURCH_ID}`,
      headers: authedHeaders(token),
      payload: {},
    });
    expect(res.statusCode).toBe(400);
  });

  it("rejects unknown body properties (strict)", async () => {
    const token = await ownerToken();
    const res = await app.inject({
      method: "PATCH",
      url: `/members/${CHURCH_ID}`,
      headers: authedHeaders(token),
      payload: { firstName: "Jane", isAdmin: true },
    });
    expect(res.statusCode).toBe(400);
  });

  it("rejects a non-uuid id", async () => {
    const token = await ownerToken();
    const res = await app.inject({
      method: "PATCH",
      url: "/members/not-a-uuid",
      headers: authedHeaders(token),
      payload: { firstName: "Jane" },
    });
    expect(res.statusCode).toBe(400);
  });
});

describe("DELETE /members/:id", () => {
  it("rejects an unauthenticated request", async () => {
    const res = await app.inject({ method: "DELETE", url: `/members/${CHURCH_ID}` });
    expect(res.statusCode).toBe(401);
  });

  it("forbids a role without members.delete", async () => {
    const token = await financeToken();
    const res = await app.inject({
      method: "DELETE",
      url: `/members/${CHURCH_ID}`,
      headers: authedHeaders(token),
    });
    expect(res.statusCode).toBe(403);
  });

  it("rejects a non-uuid id", async () => {
    const token = await ownerToken();
    const res = await app.inject({
      method: "DELETE",
      url: "/members/not-a-uuid",
      headers: authedHeaders(token),
    });
    expect(res.statusCode).toBe(400);
  });
});

describe("POST /members/:id/restore", () => {
  it("rejects an unauthenticated request", async () => {
    const res = await app.inject({ method: "POST", url: `/members/${CHURCH_ID}/restore` });
    expect(res.statusCode).toBe(401);
  });

  it("forbids a role without members.delete", async () => {
    const token = await financeToken();
    const res = await app.inject({
      method: "POST",
      url: `/members/${CHURCH_ID}/restore`,
      headers: authedHeaders(token),
    });
    expect(res.statusCode).toBe(403);
  });
});

describe("GET /members/search", () => {
  it("rejects an unauthenticated request", async () => {
    const res = await app.inject({ method: "GET", url: "/members/search?q=jon" });
    expect(res.statusCode).toBe(401);
  });

  it("rejects a missing query", async () => {
    const token = await ownerToken();
    const res = await app.inject({
      method: "GET",
      url: "/members/search",
      headers: authedHeaders(token),
    });
    expect(res.statusCode).toBe(400);
  });

  it("returns 503 when search is not configured", async () => {
    // MEILI_HOST is unset in tests, so search is unconfigured and degrades.
    const token = await ownerToken();
    const res = await app.inject({
      method: "GET",
      url: "/members/search?q=jon",
      headers: authedHeaders(token),
    });
    expect(res.statusCode).toBe(503);
    expect(res.json()).toMatchObject({ error: "SearchUnavailable" });
  });
});

describe("POST /members/:id/status", () => {
  it("rejects an unauthenticated request", async () => {
    const res = await app.inject({
      method: "POST",
      url: `/members/${CHURCH_ID}/status`,
      payload: { status: "inactive" },
    });
    expect(res.statusCode).toBe(401);
  });

  it("forbids a role without members.write", async () => {
    const token = await financeToken();
    const res = await app.inject({
      method: "POST",
      url: `/members/${CHURCH_ID}/status`,
      headers: authedHeaders(token),
      payload: { status: "inactive" },
    });
    expect(res.statusCode).toBe(403);
  });

  it("rejects an invalid status enum", async () => {
    const token = await ownerToken();
    const res = await app.inject({
      method: "POST",
      url: `/members/${CHURCH_ID}/status`,
      headers: authedHeaders(token),
      payload: { status: "vip" },
    });
    expect(res.statusCode).toBe(400);
  });

  it("rejects a body missing status", async () => {
    const token = await ownerToken();
    const res = await app.inject({
      method: "POST",
      url: `/members/${CHURCH_ID}/status`,
      headers: authedHeaders(token),
      payload: {},
    });
    expect(res.statusCode).toBe(400);
  });

  it("rejects a non-uuid id", async () => {
    const token = await ownerToken();
    const res = await app.inject({
      method: "POST",
      url: "/members/not-a-uuid/status",
      headers: authedHeaders(token),
      payload: { status: "inactive" },
    });
    expect(res.statusCode).toBe(400);
  });
});
