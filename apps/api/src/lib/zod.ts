import type { FastifyInstance, FastifySchema } from "fastify";
import {
  jsonSchemaTransform,
  serializerCompiler,
  validatorCompiler,
  type ZodTypeProvider,
} from "fastify-type-provider-zod";

/**
 * Zod validation wiring for an app that ALSO has JSON-Schema routes.
 *
 * The existing routes (churches, roles, ...) validate with Fastify's bundled
 * ajv via plain JSON Schema. The people-facing routes (members, households,
 * groups) validate with zod instead. The two styles coexist by keeping the zod
 * compilers and the zod Swagger transform scoped to the zod routes only — a
 * global swap would break every JSON-Schema route (the library's transform and
 * serializer throw on a non-zod schema).
 */

export { serializerCompiler, validatorCompiler };
export type { ZodTypeProvider };

/** A zod schema instance, recognised structurally (has parse/safeParse). */
function isZodSchema(value: unknown): boolean {
  return (
    typeof value === "object" &&
    value !== null &&
    typeof (value as { parse?: unknown }).parse === "function" &&
    typeof (value as { safeParse?: unknown }).safeParse === "function"
  );
}

/** True when any part of a route's schema is a zod schema. */
function routeUsesZod(schema: FastifySchema | undefined): boolean {
  if (!schema) return false;
  if (
    isZodSchema(schema.body) ||
    isZodSchema(schema.querystring) ||
    isZodSchema(schema.params) ||
    isZodSchema(schema.headers)
  ) {
    return true;
  }
  const response = schema.response;
  if (response && typeof response === "object") {
    return Object.values(response as Record<string, unknown>).some(isZodSchema);
  }
  return false;
}

/**
 * Swagger transform for the mixed app: zod routes are converted with the
 * library's jsonSchemaTransform; JSON-Schema routes are returned untouched so
 * @fastify/swagger keeps documenting them natively. (Passing a JSON-Schema route
 * through jsonSchemaTransform throws InvalidSchemaError.)
 */
export const zodSwaggerTransform: typeof jsonSchemaTransform = (input) => {
  if (routeUsesZod(input.schema as FastifySchema | undefined)) {
    return jsonSchemaTransform(input);
  }
  return { schema: input.schema, url: input.url };
};

type RouteModule = (app: FastifyInstance) => Promise<void>;

/**
 * Register zod-validated route modules inside an encapsulated context whose
 * validator/serializer compilers are zod. Because the compilers are set on the
 * child context (not the root), the app's JSON-Schema routes keep using ajv.
 * Each module still calls `app.withTypeProvider<ZodTypeProvider>()` for inferred
 * request/response types.
 */
export function registerZodModules(app: FastifyInstance, modules: RouteModule[]): void {
  app.register(async (scoped) => {
    scoped.setValidatorCompiler(validatorCompiler);
    scoped.setSerializerCompiler(serializerCompiler);
    for (const mod of modules) {
      await scoped.register(mod);
    }
  });
}
