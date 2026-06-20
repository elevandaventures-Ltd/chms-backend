import fp from "fastify-plugin";
import { ensureAllIndexes, getMeiliClient } from "../lib/meili.js";

/**
 * On boot, ensure the Meilisearch indexes (members, groups, households) exist and
 * their settings are applied — but only when search is configured, and never
 * blocking or failing startup. The setup runs fire-and-forget so a slow or down
 * search engine can't delay readiness or crash the API (which serves everything
 * else without it).
 */
export const meiliPlugin = fp(
  async (app) => {
    const client = getMeiliClient();
    if (!client) {
      app.log.info("Meilisearch not configured; search disabled");
      return;
    }
    void ensureAllIndexes(client)
      .then(() => app.log.info("Meilisearch indexes ready"))
      .catch((err) => app.log.warn({ err }, "Meilisearch index init failed"));
  },
  { name: "meili" },
);
