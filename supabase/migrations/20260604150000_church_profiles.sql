-- Migration: church_profiles + atomic tenant provisioning.
--
-- Two pieces:
--   1. public.church_profiles -- one row per church holding branding,
--      denomination, a (mirrored) timezone, and a free-form custom_fields JSONB
--      bag for tenant-specific settings. Kept separate from public.churches so
--      the hot, frequently-joined core row stays lean while the settings/branding
--      payload can grow without touching every church query.
--   2. public.create_church_with_owner -- the registration primitive. Creating a
--      tenant means three writes that must all succeed or all fail: the church,
--      its default profile, and the owner role row. supabase-js cannot wrap
--      separate .insert() calls in one transaction, so we do it in a single
--      plpgsql function (one statement == one transaction == atomic). This is
--      what makes "provision a workspace" reliable rather than a half-created
--      church if the second insert fails.

-- church_profiles ------------------------------------------------------------

create table public.church_profiles (
  church_id        uuid primary key references public.churches(id) on delete cascade,
  denomination     text,
  logo_url         text,
  -- Brand colours as #rrggbb hex; defaults are the app's neutral palette.
  primary_color    text not null default '#4F46E5',
  secondary_color  text not null default '#1E293B',
  -- Mirrors churches.timezone (the canonical scheduling timezone) but lives here
  -- as part of the editable settings surface. Seeded together at registration.
  timezone         text not null default 'UTC',
  -- Tenant-defined extra settings; shape is owned by the application layer.
  custom_fields    jsonb not null default '{}'::jsonb,
  created_at       timestamptz not null default now(),
  updated_at       timestamptz not null default now()
);

create trigger church_profiles_set_updated_at
  before update on public.church_profiles
  for each row execute function public.set_updated_at();

-- RLS ------------------------------------------------------------------------
-- Same model as the other tenant tables (see 20260604140000_rls_policies.sql):
-- scope is read from the JWT church_id claim, never re-derived from the table.
alter table public.church_profiles enable row level security;

-- A signed-in user sees only their own church's profile. No claim => NULL
-- comparison => no rows.
create policy church_profiles_select_own on public.church_profiles
  for select
  to authenticated
  using (church_id = (select (auth.jwt() ->> 'church_id')::uuid));

-- Owners/admins may edit their own church's profile. Inserts/deletes stay
-- default-deny; provisioning happens through create_church_with_owner below,
-- run with the service_role key after the API's own authz checks.
create policy church_profiles_admin_update on public.church_profiles
  for update
  to authenticated
  using (
    church_id = (select (auth.jwt() ->> 'church_id')::uuid)
    and (select auth.jwt() ->> 'user_role') in ('owner', 'admin')
  )
  with check (
    church_id = (select (auth.jwt() ->> 'church_id')::uuid)
    and (select auth.jwt() ->> 'user_role') in ('owner', 'admin')
  );

-- create_church_with_owner ---------------------------------------------------
-- Atomic provisioning. The owner is passed explicitly (p_owner_id) rather than
-- read from auth.uid(): the API calls this with the service_role key after it
-- has already verified the caller's JWT, matching the established
-- "mutations via service_role after authz checks" pattern. SECURITY DEFINER +
-- empty search_path keeps it safe regardless of caller, and every reference is
-- schema-qualified accordingly.
--
-- Returns the freshly created church row. A unique-violation on the slug
-- (SQLSTATE 23505) propagates to the caller, which maps it to HTTP 409.
create or replace function public.create_church_with_owner(
  p_owner_id        uuid,
  p_name            text,
  p_slug            text,
  p_timezone        text default 'UTC',
  p_locale          text default 'en',
  p_denomination    text default null,
  p_logo_url        text default null,
  p_primary_color   text default '#4F46E5',
  p_secondary_color text default '#1E293B',
  p_custom_fields   jsonb default '{}'::jsonb
)
returns public.churches
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_church public.churches;
begin
  if p_owner_id is null then
    raise exception 'owner id is required' using errcode = '22004';
  end if;

  insert into public.churches (slug, name, timezone, locale)
  values (p_slug, p_name, coalesce(p_timezone, 'UTC'), coalesce(p_locale, 'en'))
  returning * into v_church;

  insert into public.church_profiles (
    church_id, denomination, logo_url, primary_color, secondary_color, timezone, custom_fields
  )
  values (
    v_church.id,
    p_denomination,
    p_logo_url,
    coalesce(p_primary_color, '#4F46E5'),
    coalesce(p_secondary_color, '#1E293B'),
    coalesce(p_timezone, 'UTC'),
    coalesce(p_custom_fields, '{}'::jsonb)
  );

  insert into public.user_roles (user_id, church_id, role)
  values (p_owner_id, v_church.id, 'owner');

  return v_church;
end;
$$;

-- Only the service_role may provision a tenant. Lock everyone else out so the
-- function can never be invoked directly from a user-scoped or anon client.
revoke execute on function public.create_church_with_owner(
  uuid, text, text, text, text, text, text, text, text, jsonb
) from public, anon, authenticated;

grant execute on function public.create_church_with_owner(
  uuid, text, text, text, text, text, text, text, text, jsonb
) to service_role;
