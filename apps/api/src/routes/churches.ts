import type { FastifyInstance } from "fastify";
import { createSupabaseAdminClient, type Json } from "@repo/db";
import type { CreateChurchRequest, CreateChurchResponse } from "@repo/api-types";

// Hex colour (#rrggbb). Fastify's bundled ajv has no named string formats, so
// constraints are expressed as patterns.
const HEX_COLOR_PATTERN = "^#[0-9a-fA-F]{6}$";

const createChurchSchema = {
  type: "object",
  required: ["name"],
  additionalProperties: false,
  properties: {
    name: { type: "string", minLength: 1, maxLength: 200 },
    slug: { type: "string", minLength: 1, maxLength: 100 },
    timezone: { type: "string", minLength: 1, maxLength: 64 },
    locale: { type: "string", minLength: 1, maxLength: 16 },
    denomination: { type: "string", maxLength: 120 },
    logoUrl: { type: "string", maxLength: 2048 },
    primaryColor: { type: "string", pattern: HEX_COLOR_PATTERN },
    secondaryColor: { type: "string", pattern: HEX_COLOR_PATTERN },
    customFields: { type: "object", additionalProperties: true },
  },
} as const;

// Postgres unique_violation — surfaced by supabase-js as error.code.
const PG_UNIQUE_VIOLATION = "23505";

// Registration is rarer and more expensive than a normal request; cap it well
// below the global limit to blunt accidental double-submits and abuse.
const registrationRateLimit = {
  config: { rateLimit: { max: 10, timeWindow: "1 minute" } },
};

/**
 * Turn arbitrary text into a URL-safe slug: lowercased, non-alphanumeric runs
 * collapsed to single hyphens, leading/trailing hyphens trimmed. Returns "" for
 * input that contains no alphanumerics (e.g. "!!!"), which the caller rejects.
 */
function slugify(input: string): string {
  return input
    .toLowerCase()
    .normalize("NFKD")
    .replace(/[^a-z0-9]+/g, "-")
    .replace(/^-+|-+$/g, "");
}

export async function churchesRoutes(app: FastifyInstance): Promise<void> {
  /**
   * Register a new church (tenant). The authenticated caller becomes its owner.
   * Provisioning — church row + default profile + owner role — happens
   * atomically in create_church_with_owner so a partial tenant can never exist.
   */
  app.post(
    "/churches",
    {
      ...registrationRateLimit,
      onRequest: [app.authenticate],
      schema: { body: createChurchSchema },
    },
    async (req, reply) => {
      const auth = req.auth;
      // authenticate() guarantees req.auth is set, but narrow for the types.
      if (!auth) {
        return reply.code(401).send({ error: "Unauthorized", message: "Missing bearer token" });
      }

      const body = req.body as CreateChurchRequest;
      const slug = slugify(body.slug ?? body.name);
      if (!slug) {
        return reply.code(400).send({
          error: "InvalidSlug",
          message: "Could not derive a URL-safe slug; provide a slug explicitly.",
        });
      }

      const supabase = createSupabaseAdminClient();
      const { data, error } = await supabase.rpc("create_church_with_owner", {
        p_owner_id: auth.userId,
        p_name: body.name,
        p_slug: slug,
        p_timezone: body.timezone,
        p_locale: body.locale,
        p_denomination: body.denomination,
        p_logo_url: body.logoUrl,
        p_primary_color: body.primaryColor,
        p_secondary_color: body.secondaryColor,
        p_custom_fields: body.customFields as Json | undefined,
      });

      if (error) {
        if (error.code === PG_UNIQUE_VIOLATION) {
          return reply.code(409).send({
            error: "SlugTaken",
            message: `The slug "${slug}" is already in use.`,
          });
        }
        req.log.error({ err: error }, "church provisioning failed");
        return reply.code(500).send({
          error: "ProvisioningFailed",
          message: "Could not create the church. Please try again.",
        });
      }

      const response: CreateChurchResponse = {
        church: data,
        role: "owner",
        message: "Church created. Refresh your session to pick up your new church and role.",
      };
      return reply.code(201).send(response);
    },
  );
}
