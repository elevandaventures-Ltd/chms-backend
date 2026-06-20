-- Migration 005: soft-delete for public.members.
--
-- Members are never hard-deleted: a person's history (giving, attendance,
-- pastoral notes) must survive their removal from the active directory, and a
-- removal must be reversible. `deleted_at` is the tombstone -- non-null means
-- "removed". The API filters `deleted_at is null` on the read paths and exposes
-- a restore endpoint that clears it; it never issues a DELETE against this table.

alter table public.members
  add column deleted_at timestamptz;

comment on column public.members.deleted_at is
  'Soft-delete tombstone. Non-null = removed from the active directory but retained for history and restore. The API filters deleted_at is null by default and never hard-deletes.';

-- The dominant read pattern lists only live members; a partial index keeps that
-- path fast and small without indexing tombstoned rows.
create index members_church_active_idx
  on public.members (church_id)
  where deleted_at is null;
