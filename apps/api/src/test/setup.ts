// Test-only environment defaults. Lets buildApp() register the auth/JWT
// plugin without a real Supabase project. Never used outside tests.
process.env.SUPABASE_JWT_SECRET ??= "test-secret-at-least-32-characters-long-xx";
process.env.SUPABASE_URL ??= "http://localhost:54321";
process.env.SUPABASE_ANON_KEY ??= "test-anon-key";
process.env.SUPABASE_SERVICE_ROLE_KEY ??= "test-service-role-key";
