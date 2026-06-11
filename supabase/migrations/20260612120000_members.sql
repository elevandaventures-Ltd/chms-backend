-- Migration 003: public.members -- the church directory / people record.
--
-- One row per person in a church (member, visitor, prospect, ...). This is the
-- heart of the CHMS: every other people-facing feature (groups, giving,
-- check-ins, pastoral care) hangs off a member row. It is tenant data, so it
-- carries church_id and follows the same RLS model as the rest of the schema:
-- scope is read from the JWT church_id claim, never re-derived from the table
-- (see 20260604140000_rls_policies.sql).
--
-- Design notes:
--   * user_id is OPTIONAL. Most members never sign in -- they are people the
--     church tracks, not application users. When a member also has a login the
--     row points at public.users; unique(church_id, user_id) keeps that 1:1
--     within a tenant (multiple NULLs are allowed by Postgres, as intended).
--   * gender / marital_status are free-text, not enums: they vary by culture and
--     congregation and must never block a record from being created. Only
--     `status`, which drives queries and lifecycle logic, is constrained to an
--     enum (per the schema spec).
--   * Sacrament dates (baptism / communion / confirmation / ordination) are
--     first-class nullable columns because they are queried and reported on
--     directly. Looser, open-ended spiritual events live in spiritual_milestones.
--   * spiritual_milestones and custom_fields are JSONB escape hatches whose shape
--     is owned by the application layer, mirroring church_profiles.custom_fields.

-- member lifecycle status ----------------------------------------------------
-- The canonical states a person moves through. 'prospect' = not yet engaged,
-- 'visitor' = attending but not a member, 'active'/'inactive' = membership
-- standing, 'transferred' = moved to another church, 'deceased' and 'archived'
-- = soft-removed but retained for history. New rows default to 'active'.
create type public.member_status as enum (
  'prospect',
  'visitor',
  'active',
  'inactive',
  'transferred',
  'deceased',
  'archived'
);

-- members --------------------------------------------------------------------

create table public.members (
  id                 uuid primary key default gen_random_uuid(),
  church_id          uuid not null references public.churches(id) on delete cascade,
  -- Optional link to an auth-backed profile; null for the many members who
  -- never log in. Nulled (not cascaded) if the login is later deleted so the
  -- person record survives.
  user_id            uuid references public.users(id) on delete set null,

  -- Profile -----------------------------------------------------------------
  first_name         text not null,
  last_name          text,
  preferred_name     text,
  email              text,
  phone              text,
  date_of_birth      date,
  gender             text,
  marital_status     text,
  photo_url          text,

  -- Address (structured so it stays queryable; all optional).
  address_line1      text,
  address_line2      text,
  city               text,
  state_region       text,
  postal_code        text,
  country            text,

  -- Sacraments / ordination ------------------------------------------------
  baptism_date       date,
  -- First communion / admission to the Eucharist.
  communion_date     date,
  confirmation_date  date,
  ordination_date    date,

  -- Open-ended spiritual events: a JSON array of objects, e.g.
  -- [{ "type": "conversion", "date": "2019-04-21", "notes": "..." }].
  -- Shape is owned by the application layer.
  spiritual_milestones jsonb not null default '[]'::jsonb,

  -- Membership lifecycle ----------------------------------------------------
  status             public.member_status not null default 'active',
  -- Date the person became a member / first joined the church.
  joined_at          date,

  -- Free-form notes and tenant-defined extra fields.
  notes              text,
  custom_fields      jsonb not null default '{}'::jsonb,

  created_at         timestamptz not null default now(),
  updated_at         timestamptz not null default now(),

  -- At most one member row per login within a church.
  unique (church_id, user_id)
);

create trigger members_set_updated_at
  before update on public.members
  for each row execute function public.set_updated_at();

-- Access patterns: list/scope a church's directory, look a person up by their
-- login, and filter the directory by lifecycle status.
create index members_church_id_idx     on public.members (church_id);
create index members_user_id_idx       on public.members (user_id);
create index members_church_status_idx on public.members (church_id, status);

-- RLS ------------------------------------------------------------------------
-- Same model as church_profiles: any authenticated user in the church may read
-- the directory (members.read is granted to every role, down to 'member'), and
-- the comparison is JWT-scoped so a tokenless or church-less caller sees none.
alter table public.members enable row level security;

create policy members_select_own_church on public.members
  for select
  to authenticated
  using (church_id = (select (auth.jwt() ->> 'church_id')::uuid));

-- Writes (create/edit/remove members) stay default-deny. The API performs them
-- with the service_role key after its own members.write authz check, matching
-- the established "mutations via service_role after authz checks" pattern.
