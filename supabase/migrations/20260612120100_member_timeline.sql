-- Migration 004: public.member_timeline -- the per-member activity log.
--
-- An append-only stream of everything that happens to a member: check-ins,
-- giving, group joins/leaves, pastoral notes, status changes, milestones. It is
-- the data behind a member's "activity feed" and the raw material for
-- engagement reporting. Each row is one event; the variable, event-specific
-- payload lives in `metadata` JSONB so new event types never need a schema
-- change.
--
-- Append-only by design: there is no updated_at column and no update trigger.
-- Events are facts that happened -- you add a correcting event, you do not edit
-- history. `occurred_at` is when the event actually happened (which may be
-- backfilled and differ from when the row was written); `created_at` is when we
-- recorded it.
--
-- church_id is denormalised onto every row (rather than only reached through
-- member_id) so RLS can scope by the JWT church_id claim directly, with no join
-- back to public.members -- the same JWT-scoped pattern as the rest of the schema.

-- timeline event taxonomy ----------------------------------------------------
-- The known event kinds. Adding a kind is a deliberate migration; everything
-- variable about an event belongs in `metadata`, not in new enum values.
create type public.member_event_type as enum (
  'check_in',
  'giving',
  'group_join',
  'group_leave',
  'event_attendance',
  'pastoral_note',
  'status_change',
  'milestone',
  'communication',
  'note'
);

-- member_timeline ------------------------------------------------------------

create table public.member_timeline (
  id           uuid primary key default gen_random_uuid(),
  church_id    uuid not null references public.churches(id) on delete cascade,
  member_id    uuid not null references public.members(id) on delete cascade,
  event_type   public.member_event_type not null,
  -- Event-specific payload, e.g. for 'giving': { "amount": 50, "fund": "..." };
  -- for 'pastoral_note': { "body": "...", "visibility": "staff" }. Shape is
  -- owned by the application layer and keyed off event_type.
  metadata     jsonb not null default '{}'::jsonb,
  -- When the event actually happened. Defaults to now() for live events but may
  -- be set in the past when backfilling.
  occurred_at  timestamptz not null default now(),
  -- The staff member who recorded / triggered the event, for audit. Nulled (not
  -- cascaded) if that user is later deleted so the event survives.
  created_by   uuid references public.users(id) on delete set null,
  created_at   timestamptz not null default now()
);

-- Primary access pattern: one member's timeline, newest first. Secondary:
-- scope/scan a church's activity, optionally narrowed by event_type.
create index member_timeline_member_occurred_idx
  on public.member_timeline (member_id, occurred_at desc);
create index member_timeline_church_type_idx
  on public.member_timeline (church_id, event_type);

-- RLS ------------------------------------------------------------------------
-- Timeline rows include pastoral notes and giving, so unlike the directory they
-- are NOT visible to ordinary members. Read is scoped to the caller's own
-- church AND restricted to staff (every role except 'member'). Both predicates
-- come from the JWT, consistent with the rest of the schema.
alter table public.member_timeline enable row level security;

create policy member_timeline_select_staff on public.member_timeline
  for select
  to authenticated
  using (
    church_id = (select (auth.jwt() ->> 'church_id')::uuid)
    and (select auth.jwt() ->> 'user_role') <> 'member'
  );

-- Writes stay default-deny. The API appends events with the service_role key
-- after its own authz checks, matching the established mutation pattern.
