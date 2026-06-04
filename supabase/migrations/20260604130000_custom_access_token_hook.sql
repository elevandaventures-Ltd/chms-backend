-- Migration: auth wiring for the API.
--
-- Two pieces:
--   1. handle_new_user  -- mirrors every new auth.users row into public.users
--      so the FK in public.user_roles always resolves. Church/role assignment
--      remains a separate onboarding step.
--   2. custom_access_token_hook -- a Supabase auth hook that injects the user's
--      church_id and user_role into the JWT claims at sign-in. This is the
--      mechanism the RLS stubs in 20260604005500_rls_policy_stubs.sql assume:
--      `auth.jwt()->>'church_id'` and the Fastify middleware both read these
--      claims instead of hitting the DB on every request.
--
-- The hook is enabled in supabase/config.toml under [auth.hook.custom_access_token].

-- handle_new_user ------------------------------------------------------------

create or replace function public.handle_new_user()
returns trigger
language plpgsql
security definer
set search_path = ''
as $$
begin
  insert into public.users (id)
  values (new.id)
  on conflict (id) do nothing;
  return new;
end;
$$;

create trigger on_auth_user_created
  after insert on auth.users
  for each row execute function public.handle_new_user();

-- custom_access_token_hook ---------------------------------------------------
-- Receives the event jsonb { user_id, claims, ... }, looks up the caller's
-- primary role row, and (when present) adds church_id + user_role top-level
-- claims. A user with no role row simply gets a token without those claims;
-- the middleware treats that as churchId/role = null.

create or replace function public.custom_access_token_hook(event jsonb)
returns jsonb
language plpgsql
stable
as $$
declare
  claims       jsonb;
  v_church_id  uuid;
  v_role       public.user_role;
begin
  claims := event->'claims';

  select ur.church_id, ur.role
    into v_church_id, v_role
  from public.user_roles ur
  where ur.user_id = (event->>'user_id')::uuid
  order by ur.created_at asc
  limit 1;

  if v_church_id is not null then
    claims := jsonb_set(claims, '{church_id}', to_jsonb(v_church_id));
    claims := jsonb_set(claims, '{user_role}', to_jsonb(v_role));
    event  := jsonb_set(event, '{claims}', claims);
  end if;

  return event;
end;
$$;

-- The auth server runs the hook as the supabase_auth_admin role. Grant it the
-- access it needs and lock everyone else out of the function.

grant usage on schema public to supabase_auth_admin;
grant execute on function public.custom_access_token_hook(jsonb) to supabase_auth_admin;
revoke execute on function public.custom_access_token_hook(jsonb) from authenticated, anon, public;

grant select on public.user_roles to supabase_auth_admin;

-- user_roles has RLS enabled with no policies, so supabase_auth_admin would be
-- denied by default. Allow it to read role rows so the hook can resolve them.
create policy user_roles_auth_admin_read on public.user_roles
  as permissive
  for select
  to supabase_auth_admin
  using (true);
