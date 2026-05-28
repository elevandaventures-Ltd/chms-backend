-- Migration 001: initial CHMS schema (churches, users, user_roles).
--
-- Tables are created in the `public` schema with RLS enabled. No policies are
-- defined here; access from the API is denied by default until policies are
-- added in a follow-up migration. The Studio UI and the service_role key
-- bypass RLS, so the schema and data remain visible during development.

create extension if not exists "pgcrypto";

create or replace function public.set_updated_at()
returns trigger
language plpgsql
as $$
begin
  new.updated_at = now();
  return new;
end;
$$;

-- churches -------------------------------------------------------------------

create table public.churches (
  id          uuid primary key default gen_random_uuid(),
  slug        text not null unique,
  name        text not null,
  timezone    text not null default 'UTC',
  locale      text not null default 'en',
  created_at  timestamptz not null default now(),
  updated_at  timestamptz not null default now()
);

create trigger churches_set_updated_at
  before update on public.churches
  for each row execute function public.set_updated_at();

-- users ----------------------------------------------------------------------
-- public.users mirrors auth.users 1:1 and holds CHMS-specific profile fields.
-- The id matches auth.users.id so foreign keys against either resolve the same row.

create table public.users (
  id            uuid primary key references auth.users(id) on delete cascade,
  display_name  text,
  avatar_url    text,
  created_at    timestamptz not null default now(),
  updated_at    timestamptz not null default now()
);

create trigger users_set_updated_at
  before update on public.users
  for each row execute function public.set_updated_at();

-- user_roles -----------------------------------------------------------------

create type public.user_role as enum ('owner', 'admin', 'pastor', 'leader', 'member');

create table public.user_roles (
  id          uuid primary key default gen_random_uuid(),
  user_id     uuid not null references public.users(id) on delete cascade,
  church_id   uuid not null references public.churches(id) on delete cascade,
  role        public.user_role not null default 'member',
  created_at  timestamptz not null default now(),
  unique (user_id, church_id, role)
);

create index user_roles_user_id_idx   on public.user_roles (user_id);
create index user_roles_church_id_idx on public.user_roles (church_id);

-- RLS ------------------------------------------------------------------------

alter table public.churches   enable row level security;
alter table public.users      enable row level security;
alter table public.user_roles enable row level security;
