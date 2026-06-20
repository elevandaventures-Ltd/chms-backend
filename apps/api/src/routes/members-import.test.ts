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
function financeToken(): Promise<string> {
  return signToken({ sub: "fin-1", church_id: CHURCH_ID, user_role: "finance_officer" });
}

// Build a multipart/form-data body carrying one CSV "file" field.
function multipartCsv(content: string, filename = "members.csv") {
  const boundary = "----vitest" + Math.random().toString(16).slice(2);
  const payload =
    `--${boundary}\r\n` +
    `Content-Disposition: form-data; name="file"; filename="${filename}"\r\n` +
    `Content-Type: text/csv\r\n\r\n` +
    `${content}\r\n` +
    `--${boundary}--\r\n`;
  return { headers: { "content-type": `multipart/form-data; boundary=${boundary}` }, payload };
}

describe("POST /members/import", () => {
  it("rejects an unauthenticated request", async () => {
    const res = await app.inject({ method: "POST", url: "/members/import" });
    expect(res.statusCode).toBe(401);
  });

  it("forbids a role without members.write", async () => {
    const token = await financeToken();
    const res = await app.inject({
      method: "POST",
      url: "/members/import",
      headers: authedHeaders(token),
    });
    expect(res.statusCode).toBe(403);
  });

  it("rejects a session with no church scope", async () => {
    const token = await signToken({ sub: "u1", user_role: "owner" });
    const res = await app.inject({
      method: "POST",
      url: "/members/import",
      headers: authedHeaders(token),
    });
    expect(res.statusCode).toBe(403);
    expect(res.json()).toMatchObject({ error: "NoChurchContext" });
  });

  it("rejects an invalid mode query", async () => {
    const token = await ownerToken();
    const res = await app.inject({
      method: "POST",
      url: "/members/import?mode=bogus",
      headers: authedHeaders(token),
    });
    expect(res.statusCode).toBe(400);
  });

  it("400s when the request is not multipart", async () => {
    const token = await ownerToken();
    const res = await app.inject({
      method: "POST",
      url: "/members/import",
      headers: { ...authedHeaders(token), "content-type": "application/json" },
      payload: {},
    });
    expect(res.statusCode).toBe(400);
    expect(res.json()).toMatchObject({ error: "InvalidUpload" });
  });

  it("400s with NoFile when no file part is present", async () => {
    const token = await ownerToken();
    const boundary = "----vitestnofile";
    const payload =
      `--${boundary}\r\n` +
      `Content-Disposition: form-data; name="note"\r\n\r\n` +
      `hello\r\n` +
      `--${boundary}--\r\n`;
    const res = await app.inject({
      method: "POST",
      url: "/members/import",
      headers: {
        ...authedHeaders(token),
        "content-type": `multipart/form-data; boundary=${boundary}`,
      },
      payload,
    });
    expect(res.statusCode).toBe(400);
    expect(res.json()).toMatchObject({ error: "NoFile" });
  });

  it("400s with InvalidCsv when the required first_name column is missing", async () => {
    const token = await ownerToken();
    const mp = multipartCsv("last_name,email\nDoe,jane@example.com");
    const res = await app.inject({
      method: "POST",
      url: "/members/import",
      headers: { ...authedHeaders(token), ...mp.headers },
      payload: mp.payload,
    });
    expect(res.statusCode).toBe(400);
    expect(res.json()).toMatchObject({ error: "InvalidCsv" });
  });
});
