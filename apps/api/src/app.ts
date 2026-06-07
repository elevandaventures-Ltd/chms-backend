import Fastify, { type FastifyInstance } from "fastify";
import cors from "@fastify/cors";
import rateLimit from "@fastify/rate-limit";
import { config } from "./config.js";
import { authPlugin } from "./plugins/auth.js";
import { healthRoutes } from "./routes/health.js";
import { authRoutes } from "./routes/auth.js";
import { churchesRoutes } from "./routes/churches.js";
import { rolesRoutes } from "./routes/roles.js";

export function buildApp(): FastifyInstance {
  const app = Fastify({
    logger: {
      level: process.env.LOG_LEVEL ?? "info",
    },
    // Reject unknown body properties (additionalProperties: false → 400)
    // instead of Fastify's default of silently stripping them.
    ajv: {
      customOptions: { removeAdditional: false },
    },
  });

  // CORS — only the configured origins may call the API from a browser.
  app.register(cors, {
    origin: config.cors.origins,
    credentials: true,
    methods: ["GET", "POST", "PUT", "PATCH", "DELETE", "OPTIONS"],
  });

  // Global rate limit. Individual routes can tighten this via route config.
  app.register(rateLimit, {
    max: config.rateLimit.max,
    timeWindow: config.rateLimit.timeWindow,
  });

  // JWT verification + request.auth extraction.
  app.register(authPlugin);

  app.register(healthRoutes);
  app.register(authRoutes);
  app.register(churchesRoutes);
  app.register(rolesRoutes);

  return app;
}
