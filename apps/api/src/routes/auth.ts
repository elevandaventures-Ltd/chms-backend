import type { FastifyInstance } from "fastify";
import { createSupabaseAnonClient } from "@repo/db";

// Fastify's bundled ajv has no string formats by default, so email is matched
// with a pattern rather than `format: "email"`.
const EMAIL_PATTERN = "^[^@\\s]+@[^@\\s]+\\.[^@\\s]+$";

const magicLinkSchema = {
  type: "object",
  required: ["email"],
  additionalProperties: false,
  properties: {
    email: { type: "string", pattern: EMAIL_PATTERN, maxLength: 320 },
    redirectTo: { type: "string", maxLength: 2048 },
  },
} as const;

const credentialsSchema = {
  type: "object",
  required: ["email", "password"],
  additionalProperties: false,
  properties: {
    email: { type: "string", pattern: EMAIL_PATTERN, maxLength: 320 },
    password: { type: "string", minLength: 8, maxLength: 128 },
  },
} as const;

// Shared shape of every error reply ({ error, message }) for the OpenAPI doc.
const errorResponseSchema = {
  type: "object",
  properties: {
    error: { type: "string" },
    message: { type: "string" },
  },
} as const;

interface MagicLinkBody {
  email: string;
  redirectTo?: string;
}

interface CredentialsBody {
  email: string;
  password: string;
}

// Tighter limits on auth endpoints than the global default — these are the
// abuse-prone routes (credential stuffing, email bombing).
const authRateLimit = { config: { rateLimit: { max: 5, timeWindow: "1 minute" } } };

export async function authRoutes(app: FastifyInstance): Promise<void> {
  /**
   * Request a magic link. Always responds 200 on success so callers can't use
   * it to probe which emails are registered; only genuine server-side failures
   * surface as 5xx.
   */
  app.post(
    "/auth/magic-link",
    {
      ...authRateLimit,
      schema: {
        tags: ["auth"],
        summary: "Request a magic link",
        description:
          "Sends a passwordless sign-in link. Always responds 200 so callers cannot probe which emails are registered.",
        body: magicLinkSchema,
        response: {
          200: {
            type: "object",
            properties: { message: { type: "string" } },
          },
        },
      },
    },
    async (req, reply) => {
      const { email, redirectTo } = req.body as MagicLinkBody;
      const supabase = createSupabaseAnonClient();

      const { error } = await supabase.auth.signInWithOtp({
        email,
        options: { emailRedirectTo: redirectTo, shouldCreateUser: true },
      });

      if (error) {
        req.log.error({ err: error }, "magic link request failed");
      }

      return reply.code(200).send({
        message: "If that email is valid, a magic link is on its way.",
      });
    },
  );

  /** Register a new user with email + password. */
  app.post(
    "/auth/signup",
    {
      ...authRateLimit,
      schema: {
        tags: ["auth"],
        summary: "Sign up with email and password",
        body: credentialsSchema,
        response: {
          201: {
            type: "object",
            properties: {
              user: {
                type: "object",
                nullable: true,
                properties: {
                  id: { type: "string", format: "uuid" },
                  email: { type: "string", nullable: true },
                },
              },
              session: { type: "object", nullable: true, additionalProperties: true },
            },
          },
          400: errorResponseSchema,
        },
      },
    },
    async (req, reply) => {
      const { email, password } = req.body as CredentialsBody;
      const supabase = createSupabaseAnonClient();

      const { data, error } = await supabase.auth.signUp({ email, password });

      if (error) {
        req.log.warn({ err: error }, "sign up failed");
        return reply.code(400).send({ error: "SignUpFailed", message: error.message });
      }

      return reply.code(201).send({
        user: data.user ? { id: data.user.id, email: data.user.email } : null,
        session: data.session,
      });
    },
  );

  /** Log in with email + password, returning a Supabase session. */
  app.post(
    "/auth/login",
    {
      ...authRateLimit,
      schema: {
        tags: ["auth"],
        summary: "Log in with email and password",
        description: "Returns a Supabase session (access + refresh tokens) on success.",
        body: credentialsSchema,
        response: {
          200: {
            type: "object",
            properties: {
              access_token: { type: "string" },
              refresh_token: { type: "string" },
              expires_at: { type: "number", nullable: true },
              user: {
                type: "object",
                properties: {
                  id: { type: "string", format: "uuid" },
                  email: { type: "string", nullable: true },
                },
              },
            },
          },
          401: errorResponseSchema,
        },
      },
    },
    async (req, reply) => {
      const { email, password } = req.body as CredentialsBody;
      const supabase = createSupabaseAnonClient();

      const { data, error } = await supabase.auth.signInWithPassword({ email, password });

      if (error || !data.session) {
        req.log.warn({ err: error }, "login failed");
        return reply.code(401).send({
          error: "InvalidCredentials",
          message: "Email or password is incorrect",
        });
      }

      return reply.send({
        access_token: data.session.access_token,
        refresh_token: data.session.refresh_token,
        expires_at: data.session.expires_at,
        user: { id: data.user.id, email: data.user.email },
      });
    },
  );

  /** Returns the identity decoded from the bearer token. Protected. */
  app.get(
    "/auth/me",
    {
      onRequest: [app.authenticate],
      schema: {
        tags: ["auth"],
        summary: "Current identity",
        description: "Returns the identity decoded from the bearer token.",
        security: [{ bearerAuth: [] }],
        response: {
          200: {
            type: "object",
            properties: {
              user: {
                type: "object",
                nullable: true,
                properties: {
                  userId: { type: "string", format: "uuid" },
                  email: { type: "string", nullable: true },
                  churchId: { type: "string", nullable: true },
                  role: { type: "string", nullable: true },
                },
              },
            },
          },
          401: errorResponseSchema,
        },
      },
    },
    async (req) => {
      return { user: req.auth };
    },
  );
}
