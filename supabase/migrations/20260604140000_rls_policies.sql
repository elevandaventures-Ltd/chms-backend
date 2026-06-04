-- Migration: real Row-Level Security policies for tenant isolation.
--
-- 20260528115557_init.sql enables RLS on churches/users/user_roles but defines
-- no policies, so every table is default-deny for the anon and authenticated
-- roles. 20260604005500_rls_policy_stubs.sql documented the intended model as
-- commented SQL; this migration makes it real so isolation is enforced by the
-- database engine, not by application code.
--
-- Tenant scope is read from the JWT, not re-derived from the table, on purpose:
--   * church_id  -- the caller's primary church (custom_access_token_hook)
--   * user_role  -- the caller's app-level role in that church
-- Reading the admin role from the claim (rather than an EXISTS subquery against
-- public.user_roles) is deliberate: a policy on user_roles that itself selects
-- from user_roles re-enters RLS on the same table and Postgres raises
-- "infinite recursion detected in policy for relation user_roles". The claim
-- sidesteps that entirely.
--
-- Auth helpers are wrapped in a scalar sub-select -- (select auth.uid()) -- so
-- the planner evaluates them once per statement (an initPlan) instead of once
-- per row; this is the Supabase-recommended pattern for RLS performance.
--
-- Writes from user-scoped clients stay default-deny; the API performs mutations
-- with the service_role key (which bypasses RLS) after its own authz checks.
-- The single exception is a user editing their own profile (users_self_update).
--
-- service_role and supabase_auth_admin are unaffected: service_role bypasses
-- RLS, and supabase_auth_admin keeps its own read policy from migration
-- 20260604130000 so the access-token hook can still resolve role rows.

-- churches -------------------------------------------------------------------
-- A signed-in user sees only the church named in their JWT. No claim => the
-- comparison is NULL => no rows, so a tokenless or church-less caller gets none.
create policy churches_select_own on public.churches
  for select
  to authenticated
  using (id = (select (auth.jwt() ->> 'church_id')::uuid));

-- users ----------------------------------------------------------------------
-- A user can read and update only their own profile row. Identity scoping
-- (auth.uid()) is strictly tighter than church scoping, so this can never leak
-- a row belonging to another tenant. Cross-user directory visibility is left
-- out until we decide which profile fields are church-public.
create policy users_self_select on public.users
  for select
  to authenticated
  using (id = (select auth.uid()));

create policy users_self_update on public.users
  for update
  to authenticated
  using (id = (select auth.uid()))
  with check (id = (select auth.uid()));

-- user_roles -----------------------------------------------------------------
-- Every user can always see their own role rows...
create policy user_roles_self_select on public.user_roles
  for select
  to authenticated
  using (user_id = (select auth.uid()));

-- ...and owners/admins additionally see every role row scoped to their own
-- church, so they can manage members. Both predicates come from the JWT to
-- avoid RLS recursion on this table (see header).
create policy user_roles_church_admin_select on public.user_roles
  for select
  to authenticated
  using (
    church_id = (select (auth.jwt() ->> 'church_id')::uuid)
    and (select auth.jwt() ->> 'user_role') in ('owner', 'admin')
  );
