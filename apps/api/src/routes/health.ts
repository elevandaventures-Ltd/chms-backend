import type { FastifyInstance } from "fastify";

export async function healthRoutes(app: FastifyInstance): Promise<void> {
  app.get("/", async () => ({ status: "ok", service: "chms-api" }));
  app.get("/health", async () => ({ status: "ok", service: "chms-api" }));
}
