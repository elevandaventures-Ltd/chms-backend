import type { FastifyBaseLogger } from "fastify";
import type { Database, SupabaseClient } from "@repo/db";
import { logMemberEvent } from "./timeline.js";

/**
 * Member lifecycle: the allowed status transitions and the single place that
 * applies one. A member moves through a small state machine (prospect -> visitor
 * -> active, active <-> inactive, ... -> transferred/deceased/archived); not every
 * pair is a sensible move, so {@link canTransition} gates them.
 *
 * Applying a transition is more than a column write: it appends a `status_change`
 * event to the member's timeline and is the seam where future workflow side
 * effects hang (notify a pastor when someone goes inactive, send a re-engagement
 * SMS when they return, ...). {@link applyStatusChange} performs the update + hooks
 * and is reused by both POST /members/:id/status and the bulk change-status action.
 */

type MemberStatus = Database["public"]["Enums"]["member_status"];
type MemberRow = Database["public"]["Tables"]["members"]["Row"];

/**
 * Allowed target statuses from each current status. Staying put (from === to) is
 * always permitted and treated as a no-op by callers. `deceased` is effectively
 * terminal (only archival follows); `archived` can be revived to active/visitor.
 */
export const ALLOWED_TRANSITIONS: Record<MemberStatus, readonly MemberStatus[]> = {
  prospect: ["visitor", "active", "archived"],
  visitor: ["active", "inactive", "transferred", "archived"],
  active: ["inactive", "transferred", "deceased", "archived"],
  inactive: ["active", "transferred", "deceased", "archived"],
  transferred: ["active", "archived"],
  archived: ["active", "visitor"],
  deceased: ["archived"],
};

/** True if `to` is reachable from `from` (a no-op `from === to` counts as allowed). */
export function canTransition(from: MemberStatus, to: MemberStatus): boolean {
  if (from === to) return true;
  return ALLOWED_TRANSITIONS[from].includes(to);
}

/** The statuses a member in `from` may move to (excludes the no-op). */
export function allowedNextStatuses(from: MemberStatus): readonly MemberStatus[] {
  return ALLOWED_TRANSITIONS[from];
}

export interface StatusChangeParams {
  churchId: string;
  memberId: string;
  from: MemberStatus;
  to: MemberStatus;
  reason?: string | null;
  actorId?: string | null;
}

/**
 * Workflow hooks fired after a member's status changes. Today it records the
 * canonical `status_change` timeline event; additional side effects (notifications,
 * automations) slot in here. Best-effort, like all timeline logging.
 */
export async function dispatchStatusChangeHooks(
  supabase: SupabaseClient<Database>,
  params: { churchId: string; member: MemberRow; from: MemberStatus; to: MemberStatus; reason?: string | null; actorId?: string | null },
  log: FastifyBaseLogger,
): Promise<void> {
  await logMemberEvent(
    supabase,
    {
      churchId: params.churchId,
      memberId: params.member.id,
      eventType: "status_change",
      metadata: { from: params.from, to: params.to, reason: params.reason ?? null },
      createdBy: params.actorId ?? null,
    },
    log,
  );
}

/**
 * Apply a validated status transition to one active member: write the new status
 * (service_role) and fire the workflow hooks. The caller is responsible for having
 * already checked {@link canTransition}. Returns the updated row, or null when no
 * active member with that id exists in the church (or the write failed).
 */
export async function applyStatusChange(
  supabase: SupabaseClient<Database>,
  params: StatusChangeParams,
  log: FastifyBaseLogger,
): Promise<MemberRow | null> {
  const { churchId, memberId, from, to, reason, actorId } = params;

  const { data, error } = await supabase
    .from("members")
    .update({ status: to })
    .eq("church_id", churchId)
    .eq("id", memberId)
    .is("deleted_at", null)
    .select("*")
    .maybeSingle();

  if (error || !data) {
    if (error) log.error({ err: error, memberId }, "status change update failed");
    return null;
  }

  await dispatchStatusChangeHooks(
    supabase,
    { churchId, member: data, from, to, reason: reason ?? null, actorId: actorId ?? null },
    log,
  );
  return data;
}
