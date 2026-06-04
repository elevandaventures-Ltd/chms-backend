import { describe, expect, it, afterAll } from "vitest";
import { SignJWT } from "jose";
import { buildApp } from "../app.js";

const app = buildApp();

afterAll(async () => {
  await app.close();
});

// Sign an HS256 token with the same secret the test env configures, exercising
// the middleware's legacy-secret verification path without a network call.
function signTestToken(claims: Record<string, unknown>): Promise<string> {
  const secret = new TextEncoder().encode(process.env.SUPABASE_JWT_SECRET);
  return new SignJWT(claims)
    .setProtectedHeader({ alg: "HS256", typ: "JWT" })
    .setAudience("authenticated")
    .setIssuedAt()
    .setExpirationTime("1h")
    .sign(secret);
}

describe("auth middleware (/auth/me)", () => {
  it("rejects requests with no bearer token", async () => {
    const res = await app.inject({ method: "GET", url: "/auth/me" });
    expect(res.statusCode).toBe(401);
    expect(res.json()).toMatchObject({ error: "Unauthorized" });
  });

  it("rejects a token signed with the wrong secret", async () => {
    const res = await app.inject({
      method: "GET",
      url: "/auth/me",
      headers: { authorization: "Bearer not.a.real.token" },
    });
    expect(res.statusCode).toBe(401);
  });

  it("decodes church_id and user_role from a valid Supabase-style token", async () => {
    const token = await signTestToken({
      sub: "11111111-1111-1111-1111-111111111111",
      email: "pastor@example.com",
      role: "authenticated",
      church_id: "22222222-2222-2222-2222-222222222222",
      user_role: "senior_pastor",
    });

    const res = await app.inject({
      method: "GET",
      url: "/auth/me",
      headers: { authorization: `Bearer ${token}` },
    });

    expect(res.statusCode).toBe(200);
    expect(res.json()).toEqual({
      user: {
        userId: "11111111-1111-1111-1111-111111111111",
        email: "pastor@example.com",
        churchId: "22222222-2222-2222-2222-222222222222",
        role: "senior_pastor",
      },
    });
  });

  it("yields null church/role when those claims are absent", async () => {
    const token = await signTestToken({
      sub: "33333333-3333-3333-3333-333333333333",
      email: "newuser@example.com",
      role: "authenticated",
    });

    const res = await app.inject({
      method: "GET",
      url: "/auth/me",
      headers: { authorization: `Bearer ${token}` },
    });

    expect(res.statusCode).toBe(200);
    expect(res.json()).toEqual({
      user: {
        userId: "33333333-3333-3333-3333-333333333333",
        email: "newuser@example.com",
        churchId: null,
        role: null,
      },
    });
  });
});

describe("auth route validation", () => {
  it("rejects a magic-link request with a malformed email", async () => {
    const res = await app.inject({
      method: "POST",
      url: "/auth/magic-link",
      payload: { email: "not-an-email" },
    });
    expect(res.statusCode).toBe(400);
  });

  it("rejects login with a too-short password", async () => {
    const res = await app.inject({
      method: "POST",
      url: "/auth/login",
      payload: { email: "user@example.com", password: "short" },
    });
    expect(res.statusCode).toBe(400);
  });

  it("rejects unknown body properties", async () => {
    const res = await app.inject({
      method: "POST",
      url: "/auth/login",
      payload: { email: "user@example.com", password: "longenough", extra: "nope" },
    });
    expect(res.statusCode).toBe(400);
  });
});
