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
} as const;
