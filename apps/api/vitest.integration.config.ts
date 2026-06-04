import { defineConfig } from "vitest/config";

// Integration tests talk to a running local Supabase stack. They are kept out
// of the default `vitest run` (see vitest.config.ts) so unit tests stay
// hermetic, and are run explicitly with `pnpm test:integration`.
export default defineConfig({
  test: {
    environment: "node",
    include: ["src/**/*.integration.test.ts"],
    setupFiles: ["src/test/integration-setup.ts"],
    // Real HTTP round-trips (auth, PostgREST) are slower than the 5s default.
    testTimeout: 30_000,
    hookTimeout: 30_000,
  },
});
