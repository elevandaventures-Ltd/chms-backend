// Church-registration integration test.
//
// Proves the "Review" acceptance criterion for the backend: a POST /churches
// call creates a *valid database record* — not just a churches row, but the
// whole provisioned tenant (church + default church_profiles + owner role) —
// atomically, and that the owner's next token carries the church_id/user_role
// claims the access-token hook injects.
//
// Requires the local stack (`supabase start`). When it is not reachable the
// whole suite is skipped rather than failed, so it never breaks CI that has no
// Supabase running. Run explicitly with `pnpm --filter api test:integration`.
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { createSupabaseAdminClient, createSupabaseAnonClient } from "@repo/db";
import { buildApp } from "../app.js";

const PASSWORD = "church-reg-integration-pw-123";

function rand(): string {
  return Math.random().toString(36).slice(2, 10);
}

function need<T>(value: T | null | undefined, message: string): T {
  if (value === null || value === undefined) {
    throw new Error(message);
  }
  return value;
}

/** Decode a JWT payload without verifying — we only assert on claims here. */
function decodeJwtClaims(token: string): Record<string, unknown> {
  const payload = token.split(".")[1] ?? "";
  return JSON.parse(Buffer.from(payload, "base64url").toString("utf8")) as Record<string, unknown>;
}

async function stackReachable(): Promise<boolean> {
  const url = process.env.SUPABASE_URL;
  if (!url || !process.env.SUPABASE_ANON_KEY || !process.env.SUPABASE_SERVICE_ROLE_KEY) {
    return false;
  }
  try {
    const res = await fetch(new URL("/auth/v1/health", url), {
      signal: AbortSignal.timeout(2_000),
    });
    return res.ok;
  } catch {
    return false;
  }
}

const reachable = await stackReachable();

describe.skipIf(!reachable)("POST /churches provisioning", () => {
  const app = buildApp();
  const admin = createSupabaseAdminClient();

  const suffix = rand();
  const email = `church-reg-${suffix}@example.com`;
  const slug = `grace-${suffix}`;

  let userId: string;
  let token: string;
  let createdChurchId: string;

  beforeAll(async () => {
    // A brand-new user with no church/role yet — exactly the registration case.
    const { data: created, error: cErr } = await admin.auth.admin.createUser({
      email,
      password: PASSWORD,
      email_confirm: true,
    });
    userId = need(created.user, `user create failed: ${cErr?.message}`).id;

    const anon = createSupabaseAnonClient();
    const { data: signIn, error: sErr } = await anon.auth.signInWithPassword({
      email,
      password: PASSWORD,
    });
    token = need(signIn.session, `sign-in failed: ${sErr?.message}`).access_token;
  });

  afterAll(async () => {
    // Deleting the church cascades to church_profiles and user_roles; deleting
    // the auth user cascades to public.users.
    if (createdChurchId) await admin.from("churches").delete().eq("id", createdChurchId);
    if (userId) await admin.auth.admin.deleteUser(userId);
    await app.close();
  });

  it("creates a fully provisioned tenant in one call", async () => {
    const startedAt = Date.now();
    const res = await app.inject({
      method: "POST",
      url: "/churches",
      headers: { authorization: `Bearer ${token}` },
      payload: {
        name: "Grace Community Church",
        slug,
        timezone: "America/New_York",
        denomination: "Baptist",
        primaryColor: "#0EA5E9",
        customFields: { service_times: ["09:00", "11:00"] },
      },
    });

    expect(res.statusCode).toBe(201);
    // Well within the 60s provisioning budget — a sanity floor, not a benchmark.
    expect(Date.now() - startedAt).toBeLessThan(60_000);

    const body = res.json() as {
      church: { id: string; slug: string; name: string; timezone: string };
      role: string;
    };
    expect(body.role).toBe("owner");
    expect(body.church.slug).toBe(slug);
    expect(body.church.name).toBe("Grace Community Church");
    expect(body.church.timezone).toBe("America/New_York");
    createdChurchId = body.church.id;

    // The church row exists...
    const church = await admin.from("churches").select("*").eq("id", createdChurchId).single();
    expect(church.error).toBeNull();
    expect(church.data?.slug).toBe(slug);

    // ...its profile was seeded with provided values + defaults...
    const profile = await admin
      .from("church_profiles")
      .select("*")
      .eq("church_id", createdChurchId)
      .single();
    expect(profile.error).toBeNull();
    expect(profile.data?.denomination).toBe("Baptist");
    expect(profile.data?.primary_color).toBe("#0EA5E9");
    expect(profile.data?.secondary_color).toBe("#1E293B"); // default
    expect(profile.data?.timezone).toBe("America/New_York");
    expect(profile.data?.custom_fields).toEqual({ service_times: ["09:00", "11:00"] });

    // ...and the caller was granted the owner role.
    const role = await admin
      .from("user_roles")
      .select("*")
      .eq("church_id", createdChurchId)
      .eq("user_id", userId)
      .single();
    expect(role.error).toBeNull();
    expect(role.data?.role).toBe("owner");
  });

  it("issues a token carrying the new church/role claims after re-auth", async () => {
    const anon = createSupabaseAnonClient();
    const { data, error } = await anon.auth.signInWithPassword({ email, password: PASSWORD });
    const fresh = need(data.session, `re-sign-in failed: ${error?.message}`).access_token;

    const claims = decodeJwtClaims(fresh);
    expect(claims.church_id).toBe(createdChurchId);
    expect(claims.user_role).toBe("owner");
  });

  it("rejects a duplicate slug with 409", async () => {
    const res = await app.inject({
      method: "POST",
      url: "/churches",
      headers: { authorization: `Bearer ${token}` },
      payload: { name: "Another Church", slug },
    });
    expect(res.statusCode).toBe(409);
    expect(res.json()).toMatchObject({ error: "SlugTaken" });
  });
});
