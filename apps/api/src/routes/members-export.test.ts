import { describe, expect, it, afterAll } from "vitest";
import { SignJWT } from "jose";
import { buildApp } from "../app.js";

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

describe("GET /members/export", () => {
  it("rejects an unauthenticated request", async () => {
    const res = await app.inject({ method: "GET", url: "/members/export" });
    expect(res.statusCode).toBe(401);
  });

  it("rejects a session with no church scope", async () => {
    const token = await signToken({ sub: "u1", user_role: "owner" });
    const res = await app.inject({
      method: "GET",
      url: "/members/export",
      headers: authedHeaders(token),
    });
    expect(res.statusCode).toBe(403);
    expect(res.json()).toMatchObject({ error: "NoChurchContext" });
  });

  it("rejects an invalid format", async () => {
    const token = await ownerToken();
    const res = await app.inject({
      method: "GET",
      url: "/members/export?format=xml",
      headers: authedHeaders(token),
    });
    expect(res.statusCode).toBe(400);
  });

  it("rejects an invalid status filter", async () => {
    const token = await ownerToken();
    const res = await app.inject({
      method: "GET",
      url: "/members/export?status=bogus",
      headers: authedHeaders(token),
    });
    expect(res.statusCode).toBe(400);
  });
});
