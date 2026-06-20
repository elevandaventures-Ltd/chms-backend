import { describe, expect, it, afterAll } from "vitest";
import { SignJWT } from "jose";
import { buildApp } from "../app.js";

const app = buildApp();

afterAll(async () => {
  await app.close();
});

const CHURCH_ID = "11111111-1111-1111-1111-111111111111";
const MEMBER_ID = "22222222-2222-2222-2222-222222222222";

// Hermetic: every case resolves before the DB call (auth, authz, validation).
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

function ownerToken(): Promise<string> {
  return signToken({ sub: "owner-1", church_id: CHURCH_ID, user_role: "owner" });
}
function financeToken(): Promise<string> {
  return signToken({ sub: "fin-1", church_id: CHURCH_ID, user_role: "finance_officer" });
}

describe("POST /households", () => {
  it("rejects an unauthenticated request", async () => {
    const res = await app.inject({
      method: "POST",
      url: "/households",
      payload: { name: "The Smiths" },
    });
    expect(res.statusCode).toBe(401);
  });

  it("forbids a role without members.write", async () => {
    const token = await financeToken();
    const res = await app.inject({
      method: "POST",
      url: "/households",
      headers: authedHeaders(token),
      payload: { name: "The Smiths" },
    });
    expect(res.statusCode).toBe(403);
  });

  it("rejects a body missing the required name", async () => {
    const token = await ownerToken();
    const res = await app.inject({
      method: "POST",
      url: "/households",
      headers: authedHeaders(token),
      payload: {},
    });
    expect(res.statusCode).toBe(400);
  });

  it("rejects an out-of-range latitude", async () => {
    const token = await ownerToken();
    const res = await app.inject({
      method: "POST",
      url: "/households",
      headers: authedHeaders(token),
      payload: { name: "The Smiths", geoLat: 200 },
    });
    expect(res.statusCode).toBe(400);
  });

  it("rejects unknown body properties (strict)", async () => {
    const token = await ownerToken();
    const res = await app.inject({
      method: "POST",
      url: "/households",
      headers: authedHeaders(token),
      payload: { name: "The Smiths", country: "US" },
    });
    expect(res.statusCode).toBe(400);
  });
});

describe("GET /households", () => {
  it("rejects an unauthenticated request", async () => {
    const res = await app.inject({ method: "GET", url: "/households" });
    expect(res.statusCode).toBe(401);
  });

  it("rejects a pageSize over the cap", async () => {
    const token = await ownerToken();
    const res = await app.inject({
      method: "GET",
      url: "/households?pageSize=500",
      headers: authedHeaders(token),
    });
    expect(res.statusCode).toBe(400);
  });
});

describe("GET /households/:id", () => {
  it("rejects a non-uuid id", async () => {
    const token = await ownerToken();
    const res = await app.inject({
      method: "GET",
      url: "/households/not-a-uuid",
      headers: authedHeaders(token),
    });
    expect(res.statusCode).toBe(400);
  });
});

describe("PATCH /households/:id", () => {
  it("rejects an empty patch", async () => {
    const token = await ownerToken();
    const res = await app.inject({
      method: "PATCH",
      url: `/households/${CHURCH_ID}`,
      headers: authedHeaders(token),
      payload: {},
    });
    expect(res.statusCode).toBe(400);
  });
});

describe("DELETE /households/:id", () => {
  it("forbids a role without members.write", async () => {
    const token = await financeToken();
    const res = await app.inject({
      method: "DELETE",
      url: `/households/${CHURCH_ID}`,
      headers: authedHeaders(token),
    });
    expect(res.statusCode).toBe(403);
  });
});

describe("POST /households/:id/members (link)", () => {
  it("rejects an unauthenticated request", async () => {
    const res = await app.inject({
      method: "POST",
      url: `/households/${CHURCH_ID}/members`,
      payload: { memberId: MEMBER_ID, relationshipType: "spouse" },
    });
    expect(res.statusCode).toBe(401);
  });

  it("rejects an invalid relationship type", async () => {
    const token = await ownerToken();
    const res = await app.inject({
      method: "POST",
      url: `/households/${CHURCH_ID}/members`,
      headers: authedHeaders(token),
      payload: { memberId: MEMBER_ID, relationshipType: "cousin" },
    });
    expect(res.statusCode).toBe(400);
  });

  it("rejects a non-uuid memberId", async () => {
    const token = await ownerToken();
    const res = await app.inject({
      method: "POST",
      url: `/households/${CHURCH_ID}/members`,
      headers: authedHeaders(token),
      payload: { memberId: "nope", relationshipType: "spouse" },
    });
    expect(res.statusCode).toBe(400);
  });
});

describe("DELETE /households/:id/members/:memberId (unlink)", () => {
  it("rejects a non-uuid id", async () => {
    const token = await ownerToken();
    const res = await app.inject({
      method: "DELETE",
      url: `/households/not-a-uuid/members/${MEMBER_ID}`,
      headers: authedHeaders(token),
    });
    expect(res.statusCode).toBe(400);
  });
});
