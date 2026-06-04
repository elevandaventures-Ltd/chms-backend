// RLS tenant-isolation integration test.
//
// Proves that the policies in supabase/migrations/20260604140000_rls_policies.sql
// stop a signed-in user from reading another church's rows -- enforced by
// Postgres, not by application code. The key word is "even with a valid JWT":
// we mint a *real* Supabase access token (so it carries the church_id claim the
// access-token hook injects) and show cross-tenant reads still come back empty.
//
// Requires the local stack (`supabase start`). When it is not reachable the
// whole suite is skipped rather than failed, so it never breaks CI that has no
// Supabase running. Run explicitly with `pnpm --filter api test:integration`.
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import {
  createSupabaseAdminClient,
  createSupabaseAnonClient,
  createSupabaseUserClient,
  type SupabaseClient,
  type Database,
} from "@repo/db";

const PASSWORD = "rls-integration-test-pw-123";

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

describe.skipIf(!reachable)("RLS cross-tenant isolation", () => {
  const admin = createSupabaseAdminClient();

  // Populated in beforeAll.
  let churchAId: string;
  let churchBId: string;
  let userAId: string;
  let userBId: string;
  let tokenA: string;
  let userClientA: SupabaseClient<Database>;

  beforeAll(async () => {
    const suffix = rand();

    // Two tenants, created with the service-role client (bypasses RLS).
    const { data: churchA, error: errA } = await admin
      .from("churches")
      .insert({ slug: `rls-a-${suffix}`, name: "RLS Church A" })
      .select()
      .single();
    const { data: churchB, error: errB } = await admin
      .from("churches")
      .insert({ slug: `rls-b-${suffix}`, name: "RLS Church B" })
      .select()
      .single();
    churchAId = need(churchA, `church A insert failed: ${errA?.message}`).id;
    churchBId = need(churchB, `church B insert failed: ${errB?.message}`).id;

    // One auth user per tenant. handle_new_user mirrors each into public.users.
    const { data: createdA, error: cErrA } = await admin.auth.admin.createUser({
      email: `rls-a-${suffix}@example.com`,
      password: PASSWORD,
      email_confirm: true,
    });
    const { data: createdB, error: cErrB } = await admin.auth.admin.createUser({
      email: `rls-b-${suffix}@example.com`,
      password: PASSWORD,
      email_confirm: true,
    });
    userAId = need(createdA.user, `user A create failed: ${cErrA?.message}`).id;
    userBId = need(createdB.user, `user B create failed: ${cErrB?.message}`).id;

    // Give each user an owner role in their own church. This is also what the
    // access-token hook reads to populate the church_id / user_role claims.
    const { error: rErr } = await admin.from("user_roles").insert([
      { user_id: userAId, church_id: churchAId, role: "owner" },
      { user_id: userBId, church_id: churchBId, role: "owner" },
    ]);
    if (rErr) throw new Error(`role insert failed: ${rErr.message}`);

    // Sign in as user A through real Supabase auth so the issued token carries
    // the church_id=A claim. This is the "valid JWT" the test hinges on.
    const anon = createSupabaseAnonClient();
    const { data: signIn, error: sErr } = await anon.auth.signInWithPassword({
      email: `rls-a-${suffix}@example.com`,
      password: PASSWORD,
    });
    tokenA = need(signIn.session, `sign-in failed: ${sErr?.message}`).access_token;
    userClientA = createSupabaseUserClient(tokenA);
  });

  afterAll(async () => {
    // Deleting the auth users cascades to public.users and public.user_roles.
    if (userAId) await admin.auth.admin.deleteUser(userAId);
    if (userBId) await admin.auth.admin.deleteUser(userBId);
    if (churchAId && churchBId) {
      await admin.from("churches").delete().in("id", [churchAId, churchBId]);
    }
  });

  it("issues a valid JWT scoped to the caller's own church", () => {
    const claims = decodeJwtClaims(tokenA);
    expect(claims.sub).toBe(userAId);
    expect(claims.role).toBe("authenticated");
    expect(claims.church_id).toBe(churchAId);
    expect(claims.user_role).toBe("owner");
  });

  it("churches: a cross-tenant read returns 0 rows", async () => {
    const cross = await userClientA.from("churches").select("*").eq("id", churchBId);
    expect(cross.error).toBeNull();
    expect(cross.data).toEqual([]);

    // ...and an unfiltered read returns only the caller's own church.
    const own = await userClientA.from("churches").select("id");
    expect(own.error).toBeNull();
    expect(own.data).toEqual([{ id: churchAId }]);
  });

  it("user_roles: a cross-tenant read returns 0 rows", async () => {
    const byChurch = await userClientA
      .from("user_roles")
      .select("*")
      .eq("church_id", churchBId);
    expect(byChurch.error).toBeNull();
    expect(byChurch.data).toEqual([]);

    const byUser = await userClientA
      .from("user_roles")
      .select("*")
      .eq("user_id", userBId);
    expect(byUser.error).toBeNull();
    expect(byUser.data).toEqual([]);

    // The owner still sees their own church's role rows (policy works both ways).
    const own = await userClientA.from("user_roles").select("church_id");
    expect(own.error).toBeNull();
    expect(own.data).toEqual([{ church_id: churchAId }]);
  });

  it("users: only the caller's own profile row is visible", async () => {
    const other = await userClientA.from("users").select("*").eq("id", userBId);
    expect(other.error).toBeNull();
    expect(other.data).toEqual([]);

    const self = await userClientA.from("users").select("id");
    expect(self.error).toBeNull();
    expect(self.data).toEqual([{ id: userAId }]);
  });

  it("service_role sees both churches (isolation is RLS, not missing data)", async () => {
    const both = await admin
      .from("churches")
      .select("id")
      .in("id", [churchAId, churchBId]);
    expect(both.error).toBeNull();
    expect(both.data).toHaveLength(2);
  });
});
