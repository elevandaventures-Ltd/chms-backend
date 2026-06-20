import { createSupabaseAdminClient } from "@repo/db";
import { reindexAll } from "../lib/meili.js";
import type { JobLogger } from "./aging-alerts.js";

/**
 * Standalone entrypoint to rebuild the Meilisearch indexes (members, groups,
 * households) from Postgres. Run after enabling search, after a bulk data change,
 * or to repair drift:
 *
 *   npm run job:reindex
 *
 * No-op (and exits 0) when search isn't configured. Exits 1 on failure.
 */

function emit(level: string, obj: unknown, msg?: string): void {
  const base = obj && typeof obj === "object" ? obj : { detail: obj };
  const line = JSON.stringify({ level, time: new Date().toISOString(), msg, ...base });
  if (level === "error") console.error(line);
  else console.log(line);
}

const log: JobLogger = {
  info: (obj, msg) => emit("info", obj, msg),
  warn: (obj, msg) => emit("warn", obj, msg),
  error: (obj, msg) => emit("error", obj, msg),
};

async function main(): Promise<void> {
  const supabase = createSupabaseAdminClient();
  const counts = await reindexAll(supabase, log);
  log.info(counts, "reindex job finished");
}

main()
  .then(() => process.exit(0))
  .catch((err: unknown) => {
    log.error({ err: err instanceof Error ? err.message : String(err) }, "reindex job failed");
    process.exit(1);
  });
