/**
 * Centralised, validated access to the environment the API depends on.
 *
 * `requireEnv` throws at startup (during plugin registration) rather than
 * letting a request fail later with a confusing error.
 */

function requireEnv(name: string): string {
  const value = process.env[name];
  if (!value) {
    throw new Error(`Missing environment variable: ${name}`);
  }
  return value;
}

/** Comma-separated origin list, e.g. "http://localhost:3000,https://app.example.com". */
function parseOrigins(raw: string | undefined): string[] {
  if (!raw) {
    return ["http://localhost:3000"];
  }
  return raw
    .split(",")
    .map((o) => o.trim())
    .filter(Boolean);
}

export const config = {
  port: Number(process.env.PORT ?? 3001),
  host: process.env.HOST ?? "0.0.0.0",

  get supabaseUrl(): string {
    return requireEnv("SUPABASE_URL");
  },

  /**
   * JWKS endpoint exposing the asymmetric (ES256/RS256) public keys Supabase
   * signs access tokens with on modern projects.
   */
  get jwksUrl(): string {
    return new URL("/auth/v1/.well-known/jwks.json", requireEnv("SUPABASE_URL")).toString();
  },

  /**
   * Legacy shared HS256 secret. Still used by older Supabase projects (and our
   * tests). Optional: absent on projects that only use asymmetric signing keys.
   */
  get jwtSecret(): string | undefined {
    return process.env.SUPABASE_JWT_SECRET;
  },

  cors: {
    origins: parseOrigins(process.env.CORS_ORIGINS),
  },

  rateLimit: {
    /** Global ceiling per client per window. */
    max: Number(process.env.RATE_LIMIT_MAX ?? 100),
    timeWindow: process.env.RATE_LIMIT_WINDOW ?? "1 minute",
  },

  /**
   * Meilisearch (member directory search). Optional: when `host` is unset the
   * API still boots and runs — search returns 503 and index sync is skipped —
   * so a missing search engine never takes the whole service down.
   */
  meili: {
    get host(): string | undefined {
      return process.env.MEILI_HOST;
    },
    get apiKey(): string | undefined {
      return process.env.MEILI_MASTER_KEY ?? process.env.MEILI_API_KEY;
    },
  },

  /**
   * Africa's Talking SMS (member notifications, e.g. the welcome message). Optional
   * infra, exactly like Meilisearch: when `username`/`apiKey` are unset the SMS
   * sender no-ops (logged, never thrown) and member creation is unaffected.
   */
  africasTalking: {
    get username(): string | undefined {
      return process.env.AT_USERNAME;
    },
    get apiKey(): string | undefined {
      return process.env.AT_API_KEY;
    },
    /** Optional registered sender id / short code; AT uses the account default when unset. */
    get senderId(): string | undefined {
      return process.env.AT_SENDER_ID;
    },
    /**
     * API base. Defaults to the live host; point at the sandbox
     * (https://api.sandbox.africastalking.com, username "sandbox") for testing.
     */
    get host(): string {
      return process.env.AT_HOST ?? "https://api.africastalking.com";
    },
  },
} as const;
