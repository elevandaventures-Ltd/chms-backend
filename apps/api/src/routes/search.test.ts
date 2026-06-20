import { describe, expect, it, afterAll } from "vitest";
import { SignJWT } from "jose";
import { buildApp } from "../app.js";

// Hermetic tests for the group/household full-text search endpoints. MEILI_HOST is
// unset in tests, so a valid, authorised query degrades to 503 (search disabled)
// rather than hitting a live engine — mirroring members.test.ts's search cases.

const app = buildApp();

afterAll(async () => {
  await app.close();
});

const CHURCH_ID = "11111111-1111-1111-1111-111111111111";

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

describe("GET /groups/search", () => {
  it("rejects an unauthenticated request", async () => {
    const res = await app.inject({ method: "GET", url: "/groups/search?q=youth" });
    expect(res.statusCode).toBe(401);
  });

  it("rejects a missing query", async () => {
    const token = await ownerToken();
    const res = await app.inject({
      method: "GET",
      url: "/groups/search",
      headers: authedHeaders(token),
    });
    expect(res.statusCode).toBe(400);
  });

  it("returns 503 when search is not configured", async () => {
    const token = await ownerToken();
    const res = await app.inject({
      method: "GET",
      url: "/groups/search?q=youth",
      headers: authedHeaders(token),
    });
    expect(res.statusCode).toBe(503);
    expect(res.json()).toMatchObject({ error: "SearchUnavailable" });
  });
});

describe("GET /households/search", () => {
  it("rejects an unauthenticated request", async () => {
    const res = await app.inject({ method: "GET", url: "/households/search?q=smith" });
    expect(res.statusCode).toBe(401);
  });

  it("returns 503 when search is not configured", async () => {
    const token = await ownerToken();
    const res = await app.inject({
      method: "GET",
      url: "/households/search?q=smith",
      headers: authedHeaders(token),
    });
    expect(res.statusCode).toBe(503);
    expect(res.json()).toMatchObject({ error: "SearchUnavailable" });
  });
});
