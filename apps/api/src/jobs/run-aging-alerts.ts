import { createSupabaseAdminClient } from "@repo/db";
import { runAgingAlerts, type JobLogger } from "./aging-alerts.js";

/**
 * Standalone entrypoint for the daily aging-alert job. Triggered by an external
 * scheduler (server cron / platform scheduler / CI), NOT in-process, so it doesn't
 * run on every API instance:
 *
 *   # crontab — 06:00 daily
 *   0 6 * * *  cd /app/apps/api && npm run job:aging-alerts
 *
 * Exits 0 on success, 1 on failure (so a scheduler can detect a bad run).
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
  const summary = await runAgingAlerts(supabase, log);
  log.info(summary, "aging-alerts job finished");
}

main()
  .then(() => process.exit(0))
  .catch((err: unknown) => {
    log.error({ err: err instanceof Error ? err.message : String(err) }, "aging-alerts job failed");
    process.exit(1);
  });
