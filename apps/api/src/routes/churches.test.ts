import { describe, expect, it, afterAll } from "vitest";
import { SignJWT } from "jose";
import { buildApp } from "../app.js";

const app = buildApp();

afterAll(async () => {
  await app.close();
});

// Mint an HS256 token with the test secret so requests get past the
// authenticate() hook without a live Supabase project. These cases all assert
// behaviour that resolves *before* the DB call (auth, schema validation, slug
// derivation), so they stay hermetic — the happy path is covered in
// churches.integration.test.ts against a real stack.
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

describe("POST /churches", () => {
  it("rejects an unauthenticated request", async () => {
    const res = await app.inject({
      method: "POST",
      url: "/churches",
      payload: { name: "Grace Chapel" },
    });
    expect(res.statusCode).toBe(401);
    expect(res.json()).toMatchObject({ error: "Unauthorized" });
  });

  it("rejects a body missing the required name", async () => {
    const token = await signTestToken({ sub: "u1", role: "authenticated" });
    const res = await app.inject({
      method: "POST",
      url: "/churches",
      headers: authedHeaders(token),
      payload: {},
    });
    expect(res.statusCode).toBe(400);
  });

  it("rejects unknown body properties", async () => {
    const token = await signTestToken({ sub: "u1", role: "authenticated" });
    const res = await app.inject({
      method: "POST",
      url: "/churches",
      headers: authedHeaders(token),
      payload: { name: "Grace Chapel", isAdmin: true },
    });
    expect(res.statusCode).toBe(400);
  });

  it("rejects a malformed brand colour", async () => {
    const token = await signTestToken({ sub: "u1", role: "authenticated" });
    const res = await app.inject({
      method: "POST",
      url: "/churches",
      headers: authedHeaders(token),
      payload: { name: "Grace Chapel", primaryColor: "blue" },
    });
    expect(res.statusCode).toBe(400);
  });

  it("rejects a name that yields an empty slug", async () => {
    const token = await signTestToken({ sub: "u1", role: "authenticated" });
    const res = await app.inject({
      method: "POST",
      url: "/churches",
      headers: authedHeaders(token),
      // "!!!" slugifies to "" — no alphanumerics — so we never touch the DB.
      payload: { name: "!!!" },
    });
    expect(res.statusCode).toBe(400);
    expect(res.json()).toMatchObject({ error: "InvalidSlug" });
  });
});
