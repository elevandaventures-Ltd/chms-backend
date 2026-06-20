import { describe, expect, it, afterAll } from "vitest";
import { SignJWT } from "jose";
import { buildApp } from "../app.js";

const app = buildApp();

afterAll(async () => {
  await app.close();
});

const CHURCH_ID = "11111111-1111-1111-1111-111111111111";
const MEMBER_ID = "22222222-2222-2222-2222-222222222222";

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

describe("POST /members/bulk-action", () => {
  it("rejects an unauthenticated request", async () => {
    const res = await app.inject({
      method: "POST",
      url: "/members/bulk-action",
      payload: { action: "archive", memberIds: [MEMBER_ID] },
    });
    expect(res.statusCode).toBe(401);
  });

  it("forbids a role without members.write", async () => {
    const token = await financeToken();
    const res = await app.inject({
      method: "POST",
      url: "/members/bulk-action",
      headers: authedHeaders(token),
      payload: { action: "archive", memberIds: [MEMBER_ID] },
    });
    expect(res.statusCode).toBe(403);
  });

  it("rejects an unknown action", async () => {
    const token = await ownerToken();
    const res = await app.inject({
      method: "POST",
      url: "/members/bulk-action",
      headers: authedHeaders(token),
      payload: { action: "nuke", memberIds: [MEMBER_ID] },
    });
    expect(res.statusCode).toBe(400);
  });

  it("rejects an empty memberIds array", async () => {
    const token = await ownerToken();
    const res = await app.inject({
      method: "POST",
      url: "/members/bulk-action",
      headers: authedHeaders(token),
      payload: { action: "archive", memberIds: [] },
    });
    expect(res.statusCode).toBe(400);
  });

  it("rejects a non-uuid member id", async () => {
    const token = await ownerToken();
    const res = await app.inject({
      method: "POST",
      url: "/members/bulk-action",
      headers: authedHeaders(token),
      payload: { action: "archive", memberIds: ["not-a-uuid"] },
    });
    expect(res.statusCode).toBe(400);
  });

  it("rejects unknown body properties (strict)", async () => {
    const token = await ownerToken();
    const res = await app.inject({
      method: "POST",
      url: "/members/bulk-action",
      headers: authedHeaders(token),
      payload: { action: "archive", memberIds: [MEMBER_ID], extra: true },
    });
    expect(res.statusCode).toBe(400);
  });
});
