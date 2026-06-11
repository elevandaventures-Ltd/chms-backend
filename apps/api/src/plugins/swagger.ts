import fp from "fastify-plugin";
import swagger from "@fastify/swagger";
import swaggerUi from "@fastify/swagger-ui";

/**
 * OpenAPI generation + Swagger UI. `@fastify/swagger` reads the JSON Schemas
 * already attached to every route (body/params/response) and turns them into an
 * OpenAPI 3 document; `@fastify/swagger-ui` serves the interactive explorer.
 *
 * Must be registered before the routes so their schemas are captured. The
 * `bearerAuth` security scheme matches the `Authorization: Bearer <token>`
 * header the auth plugin expects; routes opt in via `schema.security`.
 */
export const swaggerPlugin = fp(
  async (app) => {
    await app.register(swagger, {
      openapi: {
        info: {
          title: "CHMS API",
          description: "Church Management System API.",
          version: "0.1.0",
        },
        components: {
          securitySchemes: {
            bearerAuth: {
              type: "http",
              scheme: "bearer",
              bearerFormat: "JWT",
              description: "Supabase access token (JWT). Obtain one via /auth/login.",
            },
          },
        },
        tags: [
          { name: "health", description: "Liveness and service metadata" },
          { name: "auth", description: "Authentication and identity" },
          { name: "churches", description: "Church (tenant) provisioning" },
          { name: "roles", description: "Role assignments within a church" },
        ],
      },
    });

    await app.register(swaggerUi, {
      routePrefix: "/docs",
      uiConfig: { docExpansion: "list", deepLinking: true },
    });
  },
  { name: "swagger" },
);
