-- Drop the unused reservations feature.
--
-- The reservations UI + routes were reverted (owner decision 2026-10-09) and NOTHING in src/
-- references it today (grep: 0 hits). Production nevertheless still carries the table, its
-- `reservation_status` enum, four RLS policies, five indexes and three SECURITY DEFINER RPCs
-- that grant EXECUTE to `authenticated` — and no migration in this repo ever created them.
-- That is the repo↔production drift recorded in docs/audit-2026-10/REMEDIATION.md: a fresh
-- `supabase db reset` does not reproduce production, and no test can cover these objects.
--
-- Measured on production before writing this (2026-10-18):
--   rows: 0                      -> no data is lost
--   views depending on it: 0
--   reservation_status used by: reservations.status only
--   RPC EXECUTE: authenticated + service_role (never anon)
--   callers in src/: 0
--
-- Rollback: the objects exist nowhere in the repo, so a rollback means restoring the definitions
-- from this file's counterpart in the production backup / the Supabase dashboard. Recreating them
-- is not needed by any code path.

begin;

-- Functions first: they are SECURITY DEFINER and reference the table by name.
drop function if exists public.create_reservation(uuid, uuid, text, text, integer, timestamptz, integer, text);
drop function if exists public.update_reservation(uuid, text, uuid, text, text, integer, timestamptz, integer, text, boolean);
drop function if exists public.delete_reservation(uuid);

-- The table carries its own policies, indexes and constraints.
drop table if exists public.reservations;

-- The enum was created for this one column.
drop type if exists public.reservation_status;

commit;
