import type { FastifyBaseLogger } from "fastify";
import type { Database, Json, SupabaseClient } from "@repo/db";

/**
 * Append an event to a member's timeline (public.member_timeline).
 *
 * Shared by the members and groups routes (member create/update/delete,
 * group join/leave, ...). Best-effort: it logs and swallows errors so a failed
 * audit write never fails the mutation that triggered it — the member/group row
 * is the source of truth, the timeline is a derived activity log.
 */
export interface MemberEventInput {
  churchId: string;
  memberId: string;
  eventType: Database["public"]["Enums"]["member_event_type"];
  metadata?: Record<string, unknown>;
  createdBy?: string | null;
}

export async function logMemberEvent(
  supabase: SupabaseClient<Database>,
  event: MemberEventInput,
  log: FastifyBaseLogger,
): Promise<void> {
  const { error } = await supabase.from("member_timeline").insert({
    church_id: event.churchId,
    member_id: event.memberId,
    event_type: event.eventType,
    metadata: (event.metadata ?? {}) as Json,
    created_by: event.createdBy ?? null,
  });
  if (error) {
    log.error({ err: error, memberId: event.memberId }, "member_timeline append failed");
  }
}
