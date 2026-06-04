import { configDefaults, defineConfig } from "vitest/config";

export default defineConfig({
  test: {
    environment: "node",
    include: ["src/**/*.test.ts"],
    // Integration tests need a live Supabase stack; they run via
    // vitest.integration.config.ts, not the default hermetic suite.
    exclude: [...configDefaults.exclude, "src/**/*.integration.test.ts"],
    setupFiles: ["src/test/setup.ts"],
  },
});
