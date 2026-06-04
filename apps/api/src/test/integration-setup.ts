// Setup for integration tests that hit a real local Supabase stack.
//
// Unlike src/test/setup.ts (which injects fake env so unit tests can build the
// app without a backend), this loads the repo-root .env so the Supabase clients
// authenticate against the running local stack with the real anon/service keys.
import { existsSync } from "node:fs";
import { dirname, resolve } from "node:path";
import { fileURLToPath } from "node:url";

const here = dirname(fileURLToPath(import.meta.url));
// apps/api/src/test -> repo root is four levels up.
const envPath = resolve(here, "../../../../.env");

if (existsSync(envPath)) {
  process.loadEnvFile(envPath);
}
