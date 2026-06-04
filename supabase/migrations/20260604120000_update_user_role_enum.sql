-- Migration: update user_role enum to match RBAC hierarchy in execution plan.
-- Renames 'pastor' → 'senior_pastor', 'leader' → 'ministry_leader', and adds
-- 'admin_staff' and 'finance_officer'.

-- Step 1: add the new values before dropping the old ones (enum values cannot
-- be removed in a single ALTER; we rename via a new type swap instead).

alter type public.user_role add value if not exists 'senior_pastor';
alter type public.user_role add value if not exists 'admin_staff';
alter type public.user_role add value if not exists 'ministry_leader';
alter type public.user_role add value if not exists 'finance_officer';

-- Step 2: migrate any existing rows that use the old values.
update public.user_roles set role = 'senior_pastor'   where role = 'pastor';
update public.user_roles set role = 'ministry_leader' where role = 'leader';

-- Step 3: swap to a clean enum that omits the retired values.
-- PostgreSQL does not support DROP VALUE, so we replace the type entirely.
alter table public.user_roles alter column role type text;

drop type public.user_role;

create type public.user_role as enum (
  'owner',
  'admin',
  'senior_pastor',
  'admin_staff',
  'ministry_leader',
  'finance_officer',
  'member'
);

alter table public.user_roles
  alter column role type public.user_role using role::public.user_role;

-- Restore the default that was set in the init migration.
alter table public.user_roles alter column role set default 'member';
