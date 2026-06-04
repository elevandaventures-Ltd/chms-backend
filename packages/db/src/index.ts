import { createClient, type SupabaseClient } from "@supabase/supabase-js";
import type { Database } from "./types";

function requireEnv(name: string): string {
  const value = process.env[name];
  if (!value) {
    throw new Error(`Missing environment variable: ${name}`);
  }
  return value;
}

/**
 * Service-role client — bypasses RLS. Use only in trusted server-side code.
 */
export function createSupabaseAdminClient(): SupabaseClient<Database> {
  return createClient<Database>(
    requireEnv("SUPABASE_URL"),
    requireEnv("SUPABASE_SERVICE_ROLE_KEY"),
    { auth: { persistSession: false, autoRefreshToken: false } },
  );
}

/**
 * Anon client — subject to RLS, uses the public anon key.
 * Safe to instantiate on the server when no user session is available.
 */
export function createSupabaseAnonClient(): SupabaseClient<Database> {
  return createClient<Database>(requireEnv("SUPABASE_URL"), requireEnv("SUPABASE_ANON_KEY"), {
    auth: { persistSession: false, autoRefreshToken: false },
  });
}

/**
 * User-scoped client — subject to RLS, authenticated via the caller's JWT.
 * Pass the Bearer token from the incoming request so RLS policies evaluate
 * against the real user identity.
 */
export function createSupabaseUserClient(accessToken: string): SupabaseClient<Database> {
  return createClient<Database>(requireEnv("SUPABASE_URL"), requireEnv("SUPABASE_ANON_KEY"), {
    global: { headers: { Authorization: `Bearer ${accessToken}` } },
    auth: { persistSession: false, autoRefreshToken: false },
  });
}

export type { Database, Json } from "./types";
export type { SupabaseClient } from "@supabase/supabase-js";
