-- Migration 006: households + household_members -- family grouping for members.
--
-- A household is a family unit at an address (the Smiths at 12 Oak St). Members
-- are linked to it through household_members, each link tagged with the member's
-- relationship within the family (parent/child/spouse/sibling). Both tables are
-- tenant data and follow the same JWT-scoped RLS model as members: church_id is
-- read from the JWT claim, never re-derived from the row.
--
-- Naming: the PK is `id` (not `household_id`) to stay consistent with every
-- other table in the schema (members.id, churches.id, ...); `household_id` is the
-- FK column name on the junction. geo_lat/geo_lng are optional decimal
-- coordinates with sanity bounds so a bad geocode can't store nonsense.

create table public.households (
  id          uuid primary key default gen_random_uuid(),
  church_id   uuid not null references public.churches(id) on delete cascade,
  name        text not null,
  -- Single free-form mailing address (members carry the structured variant).
  address     text,
  geo_lat     numeric(9, 6) check (geo_lat is null or geo_lat between -90 and 90),
  geo_lng     numeric(9, 6) check (geo_lng is null or geo_lng between -180 and 180),
  created_at  timestamptz not null default now(),
  updated_at  timestamptz not null default now()
);

create trigger households_set_updated_at
  before update on public.households
  for each row execute function public.set_updated_at();

create index households_church_id_idx on public.households (church_id);

-- relationship of a member within their household ----------------------------
create type public.household_relationship_type as enum (
  'parent',
  'child',
  'spouse',
  'sibling'
);

-- household_members ----------------------------------------------------------
-- Junction linking a member to a household. church_id is denormalised onto the
-- row (like member_timeline) so RLS scopes by the JWT claim without a join. The
-- (household_id, member_id) PK makes a link idempotent; a member may appear in
-- more than one household (e.g. split families) but never twice in the same one.
create table public.household_members (
  household_id      uuid not null references public.households(id) on delete cascade,
  member_id         uuid not null references public.members(id) on delete cascade,
  church_id         uuid not null references public.churches(id) on delete cascade,
  relationship_type public.household_relationship_type not null,
  created_at        timestamptz not null default now(),
  created_by        uuid references public.users(id) on delete set null,
  primary key (household_id, member_id)
);

create index household_members_member_idx on public.household_members (member_id);
create index household_members_church_idx on public.household_members (church_id);

-- RLS ------------------------------------------------------------------------
-- Same model as members: any authenticated user in the church may read; writes
-- stay default-deny and go through the service_role key after the API's authz.
alter table public.households enable row level security;
alter table public.household_members enable row level security;

create policy households_select_own_church on public.households
  for select
  to authenticated
  using (church_id = (select (auth.jwt() ->> 'church_id')::uuid));

create policy household_members_select_own_church on public.household_members
  for select
  to authenticated
  using (church_id = (select (auth.jwt() ->> 'church_id')::uuid));
