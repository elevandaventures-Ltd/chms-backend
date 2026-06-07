-- Migration: data-driven RBAC catalog — roles, permissions, role_permissions,
-- and user_church_roles — added ALONGSIDE the existing enum-based user_roles.
--
-- Context: 20260528115557_init.sql and 20260604120000 established a
-- public.user_role ENUM plus a public.user_roles table that the auth stack
-- already depends on:
--   * custom_access_token_hook reads user_roles.role into the JWT user_role claim
--   * every RLS policy authorises off that claim
--   * create_church_with_owner seeds the owner's user_roles row
-- None of that changes here. This migration layers a richer, queryable RBAC model
-- on top so the app can reason about *permissions* (which a bare enum cannot
-- carry) without disturbing the working auth path. The two systems share one
-- vocabulary: roles.key IS the public.user_role enum, so the catalog can never
-- drift from the canonical role set.
--
-- Scope decisions (confirmed with product):
--   * roles + permissions are a single GLOBAL catalog shared by every church.
--     There is no church_id on roles — tenancy lives on user_church_roles.
--   * all 7 roles are seeded as assignable definitions (incl. 'member').
--   * user_church_roles is the per-tenant assignment join (user × church × role);
--     a user may hold more than one role in a church.

-- roles ----------------------------------------------------------------------
-- Global catalog. key is the public.user_role enum so this table and the
-- enum-driven auth path can never disagree on which roles exist. is_system marks
-- the seeded defaults so a future "custom roles" feature can tell them apart.
create table public.roles (
  id          uuid primary key default gen_random_uuid(),
  key         public.user_role not null unique,
  name        text not null,
  description text,
  is_system   boolean not null default true,
  created_at  timestamptz not null default now()
);

-- permissions ----------------------------------------------------------------
-- Global catalog of granular, resource.action capability keys.
create table public.permissions (
  id          uuid primary key default gen_random_uuid(),
  key         text not null unique,
  description text not null,
  created_at  timestamptz not null default now()
);

-- role_permissions -----------------------------------------------------------
-- Which permissions each role grants. Composite PK doubles as the uniqueness
-- guard; both sides cascade so editing the catalog never strands join rows.
create table public.role_permissions (
  role_id        uuid not null references public.roles(id) on delete cascade,
  permission_id  uuid not null references public.permissions(id) on delete cascade,
  primary key (role_id, permission_id)
);

-- user_church_roles ----------------------------------------------------------
-- Per-tenant assignment: a user holds a role within a church. role_id uses
-- ON DELETE RESTRICT so a role still referenced by live assignments cannot be
-- removed from the catalog by accident. assigned_by records the actor for audit
-- and is nulled (not cascaded) if that actor is later deleted.
create table public.user_church_roles (
  id          uuid primary key default gen_random_uuid(),
  user_id     uuid not null references public.users(id) on delete cascade,
  church_id   uuid not null references public.churches(id) on delete cascade,
  role_id     uuid not null references public.roles(id) on delete restrict,
  assigned_by uuid references public.users(id) on delete set null,
  created_at  timestamptz not null default now(),
  unique (user_id, church_id, role_id)
);

create index user_church_roles_user_id_idx   on public.user_church_roles (user_id);
create index user_church_roles_church_id_idx on public.user_church_roles (church_id);
create index user_church_roles_role_id_idx   on public.user_church_roles (role_id);

-- Seed: roles ----------------------------------------------------------------
insert into public.roles (key, name, description) values
  ('owner',           'Owner',                'Full control of the church workspace, including billing and ownership transfer.'),
  ('admin',           'Administrator',        'Full administrative access to people, settings, and role assignment.'),
  ('senior_pastor',   'Senior Pastor',        'Pastoral oversight of members, groups, and events.'),
  ('admin_staff',     'Administrative Staff', 'Day-to-day operational access to people, groups, and events.'),
  ('ministry_leader', 'Ministry Leader',      'Leads a ministry: manages their groups and events.'),
  ('finance_officer', 'Finance Officer',      'Manages giving, funds, and financial reports.'),
  ('member',          'Member',               'Standard congregation member with minimal directory access.');

-- Seed: permissions ----------------------------------------------------------
insert into public.permissions (key, description) values
  ('members.read',   'View member profiles and the church directory.'),
  ('members.write',  'Create and edit member profiles.'),
  ('members.delete', 'Remove member profiles.'),
  ('groups.read',    'View groups and ministries.'),
  ('groups.write',   'Create and edit groups and ministries.'),
  ('events.read',    'View events and the calendar.'),
  ('events.write',   'Create and edit events.'),
  ('finances.read',  'View giving, funds, and financial records.'),
  ('finances.write', 'Record and edit giving and financial transactions.'),
  ('reports.read',   'View reports and analytics.'),
  ('roles.read',     'View role and permission assignments.'),
  ('roles.assign',   'Assign and remove roles for staff members.'),
  ('church.manage',  'Edit church settings, branding, and profile.');

-- Seed: role_permissions -----------------------------------------------------
-- Mappings are written as INSERT ... SELECT keyed off the human-readable role
-- and permission keys so the intent stays legible and survives id reshuffles.

-- owner + admin: every permission.
insert into public.role_permissions (role_id, permission_id)
select r.id, p.id
from public.roles r
cross join public.permissions p
where r.key in ('owner', 'admin');

-- senior_pastor: full people/group/event oversight + read reports & roles; no
-- finances, no church settings.
insert into public.role_permissions (role_id, permission_id)
select r.id, p.id
from public.roles r
join public.permissions p on p.key in (
  'members.read', 'members.write', 'members.delete',
  'groups.read', 'groups.write',
  'events.read', 'events.write',
  'reports.read', 'roles.read'
)
where r.key = 'senior_pastor';

-- admin_staff: operational people/group/event access + read reports.
insert into public.role_permissions (role_id, permission_id)
select r.id, p.id
from public.roles r
join public.permissions p on p.key in (
  'members.read', 'members.write',
  'groups.read', 'groups.write',
  'events.read', 'events.write',
  'reports.read'
)
where r.key = 'admin_staff';

-- ministry_leader: manages their groups and events; reads members.
insert into public.role_permissions (role_id, permission_id)
select r.id, p.id
from public.roles r
join public.permissions p on p.key in (
  'members.read',
  'groups.read', 'groups.write',
  'events.read', 'events.write'
)
where r.key = 'ministry_leader';

-- finance_officer: owns finances + reports; reads members.
insert into public.role_permissions (role_id, permission_id)
select r.id, p.id
from public.roles r
join public.permissions p on p.key in (
  'members.read',
  'finances.read', 'finances.write',
  'reports.read'
)
where r.key = 'finance_officer';

-- member: directory read only.
insert into public.role_permissions (role_id, permission_id)
select r.id, p.id
from public.roles r
join public.permissions p on p.key = 'members.read'
where r.key = 'member';

-- RLS ------------------------------------------------------------------------
alter table public.roles             enable row level security;
alter table public.permissions       enable row level security;
alter table public.role_permissions  enable row level security;
alter table public.user_church_roles enable row level security;

-- roles / permissions / role_permissions are non-secret global definitions, so
-- any authenticated user may read the catalog (the UI needs it to render role
-- pickers and capability checks). Writes stay default-deny: the catalog is
-- managed by migrations / the service_role, never by end users.
create policy roles_select_all on public.roles
  for select
  to authenticated
  using (true);

create policy permissions_select_all on public.permissions
  for select
  to authenticated
  using (true);

create policy role_permissions_select_all on public.role_permissions
  for select
  to authenticated
  using (true);

-- user_church_roles is tenant data. Mirror the user_roles model from
-- 20260604140000_rls_policies.sql: scope is read from the JWT, never re-derived
-- from the table (avoids RLS recursion and matches the existing pattern).

-- Every user can always see their own assignment rows...
create policy user_church_roles_self_select on public.user_church_roles
  for select
  to authenticated
  using (user_id = (select auth.uid()));

-- ...and owners/admins additionally see every assignment scoped to their own
-- church, so they can manage staff. Both predicates come from the JWT.
create policy user_church_roles_church_admin_select on public.user_church_roles
  for select
  to authenticated
  using (
    church_id = (select (auth.jwt() ->> 'church_id')::uuid)
    and (select auth.jwt() ->> 'user_role') in ('owner', 'admin')
  );

-- Writes (assign/remove) stay default-deny. The API performs them with the
-- service_role key after its own owner/admin authz check, matching the
-- established "mutations via service_role after authz checks" pattern.
