import type { FastifyInstance } from "fastify";

const healthResponseSchema = {
  type: "object",
  properties: {
    status: { type: "string", example: "ok" },
    service: { type: "string", example: "chms-api" },
  },
} as const;

export async function healthRoutes(app: FastifyInstance): Promise<void> {
  app.get(
    "/",
    {
      schema: {
        tags: ["health"],
        summary: "Service root",
        description: "Liveness probe returning basic service metadata.",
        response: { 200: healthResponseSchema },
      },
    },
    async () => ({ status: "ok", service: "chms-api" }),
  );

  app.get(
    "/health",
    {
      schema: {
        tags: ["health"],
        summary: "Health check",
        description: "Liveness probe returning basic service metadata.",
        response: { 200: healthResponseSchema },
      },
    },
    async () => ({ status: "ok", service: "chms-api" }),
  );
}
