-- Migration 010: member_alerts + member_activity -- the engagement / aging-alert system.
--
-- A daily job (apps/api/src/jobs/aging-alerts.ts) flags members who have gone
-- quiet: no timeline activity for 30, 60, or 90+ days. Each at-risk member gets one
-- open row in public.member_alerts, which GET /members/alerts surfaces to staff for
-- pastoral follow-up. When a member becomes active again the job resolves their
-- alert (status = 'resolved'). The job upserts on (church_id, member_id,
-- alert_type), so re-running it is idempotent.
--
-- public.member_activity is a read-only view the job uses to compute inactivity in
-- a single pass: each member's last_activity_at is the most recent of their last
-- timeline event, their joined_at, and their created_at -- so a brand-new member
-- with no events is measured from when they joined, never flagged on day one.

-- alert taxonomy -------------------------------------------------------------
-- Only 'inactive' today; an enum (not free text) so adding kinds -- e.g.
-- 'missed_giving', 'no_group' -- stays a deliberate migration.
create type public.member_alert_type as enum ('inactive');

-- member_alerts --------------------------------------------------------------
-- church_id is denormalised onto the row (like member_timeline) so RLS scopes by
-- the JWT claim with no join. unique (church_id, member_id, alert_type) makes the
-- daily job idempotent: one row per member per alert kind, with threshold_days /
-- days_inactive bumped as the member ages.
create table public.member_alerts (
  id               uuid primary key default gen_random_uuid(),
  church_id        uuid not null references public.churches(id) on delete cascade,
  member_id        uuid not null references public.members(id) on delete cascade,
  alert_type       public.member_alert_type not null default 'inactive',
  -- The crossed inactivity bucket (30/60/90) used for filtering; days_inactive is
  -- the precise figure at detection time.
  threshold_days   integer not null check (threshold_days in (30, 60, 90)),
  days_inactive    integer not null check (days_inactive >= 0),
  last_activity_at timestamptz,
  -- 'open' = needs follow-up; 'resolved' = the member became active again.
  status           text not null default 'open' check (status in ('open', 'resolved')),
  detected_at      timestamptz not null default now(),
  resolved_at      timestamptz,
  created_at       timestamptz not null default now(),
  updated_at       timestamptz not null default now(),
  unique (church_id, member_id, alert_type)
);

create trigger member_alerts_set_updated_at
  before update on public.member_alerts
  for each row execute function public.set_updated_at();

-- Primary access pattern: a church's open alerts, filtered by bucket.
create index member_alerts_church_status_idx
  on public.member_alerts (church_id, status, threshold_days);
create index member_alerts_member_idx on public.member_alerts (member_id);

-- member_activity ------------------------------------------------------------
-- Read-only view: each member's last_activity_at = the most recent of their last
-- timeline event, joined_at, and created_at. Drives the aging job's inactivity
-- calculation in one query (no per-member round trips). security_invoker keeps the
-- view subject to the querying role's RLS rather than the view owner's, so it can
-- never leak across churches; the job reads it with the service_role key.
create view public.member_activity
  with (security_invoker = true)
  as
    select
      m.id         as member_id,
      m.church_id  as church_id,
      m.status     as status,
      m.deleted_at as deleted_at,
      greatest(
        coalesce(max(t.occurred_at), m.created_at),
        coalesce(m.joined_at::timestamptz, m.created_at)
      ) as last_activity_at
    from public.members m
    left join public.member_timeline t on t.member_id = m.id
    group by m.id, m.church_id, m.status, m.deleted_at, m.created_at, m.joined_at;

-- RLS ------------------------------------------------------------------------
-- At-risk lists are pastoral data, so -- like member_timeline -- they are staff
-- only: readable within the caller's church by every role except 'member'. Writes
-- stay default-deny; the daily job upserts with the service_role key.
alter table public.member_alerts enable row level security;

create policy member_alerts_select_staff on public.member_alerts
  for select
  to authenticated
  using (
    church_id = (select (auth.jwt() ->> 'church_id')::uuid)
    and (select auth.jwt() ->> 'user_role') <> 'member'
  );
