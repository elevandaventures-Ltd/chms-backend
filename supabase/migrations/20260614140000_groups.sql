-- Migration 007: groups + group_members -- the ministry/org hierarchy.
--
-- A church's structure is a tree: campuses -> departments -> ministries ->
-- small_groups. It is stored as an ADJACENCY LIST: one self-referential `groups`
-- table where each row points at its parent via parent_id (null = a root). This
-- keeps writes trivial (move a subtree by repointing one parent_id) at the cost
-- of recursive reads, which the API does with a recursive CTE when it needs a
-- full tree. `group_type` tags each node's level for filtering/display.
--
-- The intended nesting is campus > department > ministry > small_group, but the
-- table does not hard-enforce parent/child type pairings: real churches skip or
-- rename levels, so that policy lives in the application, not a rigid constraint.
-- Tenant data, JWT-scoped RLS, same as members.

create type public.group_type as enum (
  'campus',
  'department',
  'ministry',
  'small_group'
);

create table public.groups (
  id          uuid primary key default gen_random_uuid(),
  church_id   uuid not null references public.churches(id) on delete cascade,
  -- Self-reference for the adjacency list. A deleted parent takes its subtree
  -- with it (cascade) -- removing a campus removes everything under it.
  parent_id   uuid references public.groups(id) on delete cascade,
  group_type  public.group_type not null,
  name        text not null,
  description text,
  created_at  timestamptz not null default now(),
  updated_at  timestamptz not null default now(),
  -- A node can't be its own parent. (Deeper cycles are prevented in the API,
  -- which walks the ancestor chain before repointing a parent.)
  constraint groups_no_self_parent check (parent_id is null or parent_id <> id)
);

create trigger groups_set_updated_at
  before update on public.groups
  for each row execute function public.set_updated_at();

create index groups_church_id_idx on public.groups (church_id);
create index groups_parent_id_idx on public.groups (parent_id);

-- group_members --------------------------------------------------------------
-- Junction linking a member to a group, with an optional role within the group
-- (e.g. 'leader'). church_id is denormalised for JWT-scoped RLS without a join.
-- (group_id, member_id) PK makes assignment idempotent.
create table public.group_members (
  group_id   uuid not null references public.groups(id) on delete cascade,
  member_id  uuid not null references public.members(id) on delete cascade,
  church_id  uuid not null references public.churches(id) on delete cascade,
  role       text,
  created_at timestamptz not null default now(),
  created_by uuid references public.users(id) on delete set null,
  primary key (group_id, member_id)
);

create index group_members_member_idx on public.group_members (member_id);
create index group_members_church_idx on public.group_members (church_id);

-- RLS ------------------------------------------------------------------------
-- Any authenticated user in the church may read the structure; writes stay
-- default-deny and go through the service_role key after the API's authz.
alter table public.groups enable row level security;
alter table public.group_members enable row level security;

create policy groups_select_own_church on public.groups
  for select
  to authenticated
  using (church_id = (select (auth.jwt() ->> 'church_id')::uuid));

create policy group_members_select_own_church on public.group_members
  for select
  to authenticated
  using (church_id = (select (auth.jwt() ->> 'church_id')::uuid));
