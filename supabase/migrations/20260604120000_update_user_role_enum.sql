-- Migration: update user_role enum to match RBAC hierarchy in execution plan.
-- Renames 'pastor' → 'senior_pastor', 'leader' → 'ministry_leader', and adds
-- 'admin_staff' and 'finance_officer'.
--
-- PostgreSQL forbids using a value added via ALTER TYPE ... ADD VALUE in the
-- same transaction it was added (SQLSTATE 55P04), and each migration runs in a
-- single transaction. Since we replace the type wholesale below, we don't add
-- values at all: we drop to text, rewrite the retired values as plain text,
-- then swap in a fresh enum.

-- Step 1: drop the default so the column type can be changed freely.
alter table public.user_roles alter column role drop default;

-- Step 2: move to text so values can be rewritten without enum constraints.
alter table public.user_roles alter column role type text;

-- Step 3: migrate any rows using the retired values.
update public.user_roles set role = 'senior_pastor'   where role = 'pastor';
update public.user_roles set role = 'ministry_leader' where role = 'leader';

-- Step 4: replace the type with the new RBAC set (PostgreSQL has no DROP VALUE).
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

-- Step 5: convert the column back to the enum and restore the default.
alter table public.user_roles
  alter column role type public.user_role using role::public.user_role;

alter table public.user_roles alter column role set default 'member';
