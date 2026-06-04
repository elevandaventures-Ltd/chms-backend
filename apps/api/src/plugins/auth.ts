import fp from "fastify-plugin";
import {
  createRemoteJWKSet,
  jwtVerify,
  type JWTPayload,
  type JWTVerifyGetKey,
  type JWSHeaderParameters,
  type KeyLike,
} from "jose";
import type { FastifyReply, FastifyRequest } from "fastify";
import type { UserRole } from "@repo/api-types";
import { config } from "../config.js";

/**
 * Custom claims added by the custom_access_token_hook DB function
 * (migration 20260604130000). Absent for users with no role row.
 */
export interface SupabaseJwtPayload extends JWTPayload {
  email?: string;
  /** Postgres role, e.g. "authenticated" — not the app-level user role. */
  role?: string;
  session_id?: string;
  church_id?: string;
  user_role?: UserRole;
}

/** Normalised identity attached to every authenticated request. */
export interface AuthContext {
  userId: string;
  email: string | null;
  churchId: string | null;
  role: UserRole | null;
}

declare module "fastify" {
  interface FastifyRequest {
    auth: AuthContext | null;
  }
  interface FastifyInstance {
    /** onRequest hook that verifies the bearer token or replies 401. */
    authenticate: (req: FastifyRequest, reply: FastifyReply) => Promise<void>;
  }
}

const BEARER_PREFIX = "Bearer ";

/**
 * Registers JWT verification and an `authenticate` hook. Supabase signs access
 * tokens with asymmetric keys (ES256/RS256) on modern projects — verified via
 * the JWKS endpoint — and falls back to the legacy HS256 shared secret when one
 * is configured. The decoded claims are projected onto `request.auth` and
 * logged so JWT decoding is visible in the API logs.
 */
export const authPlugin = fp(
  async (app) => {
    const remoteJwks = createRemoteJWKSet(new URL(config.jwksUrl));
    const hsSecret = config.jwtSecret
      ? new TextEncoder().encode(config.jwtSecret)
      : null;

    // Picks the verification key by the token's `alg`: the shared secret for
    // HS*, the matching JWKS public key otherwise.
    const getKey: JWTVerifyGetKey = (
      header: JWSHeaderParameters,
      token,
    ): Promise<Uint8Array | KeyLike> => {
      if (header.alg?.startsWith("HS")) {
        if (!hsSecret) {
          return Promise.reject(
            new Error("HS-signed token received but SUPABASE_JWT_SECRET is not set"),
          );
        }
        return Promise.resolve(hsSecret);
      }
      return remoteJwks(header, token);
    };

    app.decorateRequest("auth", null);

    app.decorate(
      "authenticate",
      async (req: FastifyRequest, reply: FastifyReply): Promise<void> => {
        const header = req.headers.authorization;
        if (!header || !header.startsWith(BEARER_PREFIX)) {
          await reply
            .code(401)
            .send({ error: "Unauthorized", message: "Missing bearer token" });
          return;
        }

        const token = header.slice(BEARER_PREFIX.length);
        let payload: SupabaseJwtPayload;
        try {
          ({ payload } = await jwtVerify<SupabaseJwtPayload>(token, getKey, {
            audience: "authenticated",
            algorithms: ["ES256", "RS256", "HS256"],
          }));
        } catch (err) {
          req.log.warn({ err }, "JWT verification failed");
          await reply
            .code(401)
            .send({ error: "Unauthorized", message: "Invalid or expired access token" });
          return;
        }

        if (!payload.sub) {
          await reply
            .code(401)
            .send({ error: "Unauthorized", message: "Token missing subject" });
          return;
        }

        req.auth = {
          userId: payload.sub,
          email: payload.email ?? null,
          churchId: payload.church_id ?? null,
          role: payload.user_role ?? null,
        };

        req.log.info(
          {
            userId: req.auth.userId,
            churchId: req.auth.churchId,
            role: req.auth.role,
          },
          "request authenticated",
        );
      },
    );
  },
  { name: "auth" },
);
