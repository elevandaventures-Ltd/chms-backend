import { describe, expect, it, afterAll } from "vitest";
import { SignJWT } from "jose";
import { buildApp } from "../app.js";

const app = buildApp();

afterAll(async () => {
  await app.close();
});

const CHURCH_ID = "11111111-1111-1111-1111-111111111111";
const MEMBER_ID = "22222222-2222-2222-2222-222222222222";

// Hermetic: each case resolves before the DB call (auth, authz, validation).
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

// owner has groups.write; finance_officer has neither groups.read nor write.
function ownerToken(): Promise<string> {
  return signToken({ sub: "owner-1", church_id: CHURCH_ID, user_role: "owner" });
}
function financeToken(): Promise<string> {
  return signToken({ sub: "fin-1", church_id: CHURCH_ID, user_role: "finance_officer" });
}

describe("POST /groups", () => {
  it("rejects an unauthenticated request", async () => {
    const res = await app.inject({
      method: "POST",
      url: "/groups",
      payload: { name: "Main Campus", groupType: "campus" },
    });
    expect(res.statusCode).toBe(401);
  });

  it("forbids a role without groups.write", async () => {
    const token = await financeToken();
    const res = await app.inject({
      method: "POST",
      url: "/groups",
      headers: authedHeaders(token),
      payload: { name: "Main Campus", groupType: "campus" },
    });
    expect(res.statusCode).toBe(403);
  });

  it("rejects a body missing the required name", async () => {
    const token = await ownerToken();
    const res = await app.inject({
      method: "POST",
      url: "/groups",
      headers: authedHeaders(token),
      payload: { groupType: "campus" },
    });
    expect(res.statusCode).toBe(400);
  });

  it("rejects an invalid group type", async () => {
    const token = await ownerToken();
    const res = await app.inject({
      method: "POST",
      url: "/groups",
      headers: authedHeaders(token),
      payload: { name: "Choir", groupType: "band" },
    });
    expect(res.statusCode).toBe(400);
  });

  it("rejects a non-uuid parentId", async () => {
    const token = await ownerToken();
    const res = await app.inject({
      method: "POST",
      url: "/groups",
      headers: authedHeaders(token),
      payload: { name: "Youth", groupType: "ministry", parentId: "nope" },
    });
    expect(res.statusCode).toBe(400);
  });
});

describe("GET /groups", () => {
  it("rejects an unauthenticated request", async () => {
    const res = await app.inject({ method: "GET", url: "/groups" });
    expect(res.statusCode).toBe(401);
  });

  it("rejects an invalid group type filter", async () => {
    const token = await ownerToken();
    const res = await app.inject({
      method: "GET",
      url: "/groups?groupType=band",
      headers: authedHeaders(token),
    });
    expect(res.statusCode).toBe(400);
  });
});

describe("GET /groups/:id", () => {
  it("rejects a non-uuid id", async () => {
    const token = await ownerToken();
    const res = await app.inject({
      method: "GET",
      url: "/groups/not-a-uuid",
      headers: authedHeaders(token),
    });
    expect(res.statusCode).toBe(400);
  });
});

describe("PATCH /groups/:id", () => {
  it("rejects an empty patch", async () => {
    const token = await ownerToken();
    const res = await app.inject({
      method: "PATCH",
      url: `/groups/${CHURCH_ID}`,
      headers: authedHeaders(token),
      payload: {},
    });
    expect(res.statusCode).toBe(400);
  });
});

describe("DELETE /groups/:id", () => {
  it("forbids a role without groups.write", async () => {
    const token = await financeToken();
    const res = await app.inject({
      method: "DELETE",
      url: `/groups/${CHURCH_ID}`,
      headers: authedHeaders(token),
    });
    expect(res.statusCode).toBe(403);
  });
});

describe("POST /groups/:id/members (assign)", () => {
  it("rejects an unauthenticated request", async () => {
    const res = await app.inject({
      method: "POST",
      url: `/groups/${CHURCH_ID}/members`,
      payload: { memberId: MEMBER_ID },
    });
    expect(res.statusCode).toBe(401);
  });

  it("rejects a missing memberId", async () => {
    const token = await ownerToken();
    const res = await app.inject({
      method: "POST",
      url: `/groups/${CHURCH_ID}/members`,
      headers: authedHeaders(token),
      payload: { role: "leader" },
    });
    expect(res.statusCode).toBe(400);
  });
});

describe("DELETE /groups/:id/members/:memberId (remove)", () => {
  it("rejects a non-uuid id", async () => {
    const token = await ownerToken();
    const res = await app.inject({
      method: "DELETE",
      url: `/groups/not-a-uuid/members/${MEMBER_ID}`,
      headers: authedHeaders(token),
    });
    expect(res.statusCode).toBe(400);
  });
});
