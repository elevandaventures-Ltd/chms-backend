import type { Database, SupabaseClient } from "@repo/db";

/**
 * The aging / engagement alert job (Task 5). Run daily (cron `0 6 * * *`) via the
 * standalone entrypoint run-aging-alerts.ts.
 *
 * It reads the public.member_activity view — each member's last_activity_at, the
 * most recent of their last timeline event / joined_at / created_at — and flags
 * anyone past a 30/60/90-day inactivity bucket into public.member_alerts. Members
 * in a terminal-ish status (deceased/transferred/archived) or soft-deleted are
 * skipped. Idempotent: it upserts one open alert per member (re-opening a resolved
 * one if they lapse again) and resolves any open alert whose member is now active.
 *
 * Runs system-wide with the service_role key (no church scope, RLS bypassed);
 * every row already carries its church_id.
 */

const EXCLUDED_STATUSES: readonly string[] = ["deceased", "transferred", "archived"];
const DAY_MS = 24 * 60 * 60 * 1000;

/** Minimal logger surface the job needs (req.log, pino, or a console shim all fit). */
export interface JobLogger {
  info: (obj: unknown, msg?: string) => void;
  warn: (obj: unknown, msg?: string) => void;
  error: (obj: unknown, msg?: string) => void;
}

/** The inactivity bucket a day-count falls into, or null when still active (<30d). */
export function bucketFor(daysInactive: number): 30 | 60 | 90 | null {
  if (daysInactive >= 90) return 90;
  if (daysInactive >= 60) return 60;
  if (daysInactive >= 30) return 30;
  return null;
}

export interface AgingAlertsSummary {
  scanned: number;
  flagged: number;
  resolved: number;
  byBucket: { 30: number; 60: number; 90: number };
}

type AlertInsert = Database["public"]["Tables"]["member_alerts"]["Insert"];

const PAGE_SIZE = 1000;
const UPSERT_CHUNK = 500;

/**
 * Recompute inactivity alerts across all churches. Returns a run summary. Throws
 * on a database error (the entrypoint turns that into a non-zero exit).
 *
 * `now` is injectable so tests and backfills can pin "today".
 */
export async function runAgingAlerts(
  supabase: SupabaseClient<Database>,
  log: JobLogger,
  opts?: { now?: Date },
): Promise<AgingAlertsSummary> {
  const now = opts?.now ?? new Date();
  const runStart = now.toISOString();
  const summary: AgingAlertsSummary = {
    scanned: 0,
    flagged: 0,
    resolved: 0,
    byBucket: { 30: 0, 60: 0, 90: 0 },
  };

  // 1) Page through the activity view, building the set of current alerts.
  const candidates: AlertInsert[] = [];
  for (let from = 0; ; from += PAGE_SIZE) {
    const { data, error } = await supabase
      .from("member_activity")
      .select("member_id, church_id, status, last_activity_at")
      .is("deleted_at", null)
      .range(from, from + PAGE_SIZE - 1);
    if (error) {
      log.error({ err: error }, "aging alerts: member_activity read failed");
      throw error;
    }
    const rows = data ?? [];
    for (const row of rows) {
      if (!row.member_id || !row.church_id || !row.last_activity_at) continue;
      if (row.status && EXCLUDED_STATUSES.includes(row.status)) continue;
      summary.scanned++;

      const days = Math.floor((now.getTime() - new Date(row.last_activity_at).getTime()) / DAY_MS);
      const bucket = bucketFor(days);
      if (bucket === null) continue;

      summary.byBucket[bucket]++;
      candidates.push({
        church_id: row.church_id,
        member_id: row.member_id,
        alert_type: "inactive",
        threshold_days: bucket,
        days_inactive: days,
        last_activity_at: row.last_activity_at,
        status: "open",
        detected_at: runStart,
        resolved_at: null,
      });
    }
    if (rows.length < PAGE_SIZE) break;
  }

  // 2) Upsert current alerts (chunked). onConflict re-opens a resolved alert and
  //    bumps the bucket/day-count; created_at is untouched (= first detected).
  for (let i = 0; i < candidates.length; i += UPSERT_CHUNK) {
    const slice = candidates.slice(i, i + UPSERT_CHUNK);
    const { error } = await supabase
      .from("member_alerts")
      .upsert(slice, { onConflict: "church_id,member_id,alert_type" });
    if (error) {
      log.error({ err: error }, "aging alerts: upsert failed");
      throw error;
    }
    summary.flagged += slice.length;
  }

  // 3) Resolve open alerts NOT re-detected this run (detected_at < runStart means
  //    the member is active again, so we didn't upsert them above).
  const { data: resolved, error: resolveErr } = await supabase
    .from("member_alerts")
    .update({ status: "resolved", resolved_at: runStart })
    .eq("alert_type", "inactive")
    .eq("status", "open")
    .lt("detected_at", runStart)
    .select("id");
  if (resolveErr) {
    log.error({ err: resolveErr }, "aging alerts: resolve failed");
    throw resolveErr;
  }
  summary.resolved = resolved?.length ?? 0;

  log.info({ summary }, "aging alerts run complete");
  return summary;
}
