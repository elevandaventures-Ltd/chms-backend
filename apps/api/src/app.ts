import Fastify, { type FastifyInstance } from "fastify";
import cors from "@fastify/cors";
import rateLimit from "@fastify/rate-limit";
import multipart from "@fastify/multipart";
import { config } from "./config.js";
import { swaggerPlugin } from "./plugins/swagger.js";
import { authPlugin } from "./plugins/auth.js";
import { meiliPlugin } from "./plugins/meili.js";
import { healthRoutes } from "./routes/health.js";
import { authRoutes } from "./routes/auth.js";
import { churchesRoutes } from "./routes/churches.js";
import { rolesRoutes } from "./routes/roles.js";
import { membersRoutes } from "./routes/members.js";
import { membersImportRoutes } from "./routes/members-import.js";
import { membersAlertsRoutes } from "./routes/members-alerts.js";
import { membersBulkRoutes } from "./routes/members-bulk.js";
import { membersExportRoutes } from "./routes/members-export.js";
import { membersGeoRoutes } from "./routes/members-geo.js";
import { householdsRoutes } from "./routes/households.js";
import { groupsRoutes } from "./routes/groups.js";
import { registerZodModules } from "./lib/zod.js";

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

  // Multipart/form-data support for file uploads (CSV member import). The limits
  // cap upload size and file count so a large upload can't exhaust memory.
  app.register(multipart, {
    limits: {
      fileSize: 5 * 1024 * 1024, // 5 MB
      files: 1,
    },
  });

  // OpenAPI doc generation + Swagger UI at /docs. Registered before the routes
  // so their schemas are captured in the generated spec.
  app.register(swaggerPlugin);

  // JWT verification + request.auth extraction.
  app.register(authPlugin);

  // Best-effort Meilisearch index setup (no-op when search isn't configured).
  app.register(meiliPlugin);

  app.register(healthRoutes);
  app.register(authRoutes);
  app.register(churchesRoutes);
  app.register(rolesRoutes);

  // People-facing routes validate with zod; registered in an encapsulated
  // context so their zod compilers don't disturb the JSON-Schema routes above.
  registerZodModules(app, [
    membersRoutes,
    membersImportRoutes,
    membersAlertsRoutes,
    membersBulkRoutes,
    membersGeoRoutes,
    householdsRoutes,
    groupsRoutes,
  ]);

  // Export streams a file (CSV/PDF), so it's registered as a plain JSON-Schema
  // route — keeping the zod response serializer away from the binary payload.
  app.register(membersExportRoutes);

  return app;
}
