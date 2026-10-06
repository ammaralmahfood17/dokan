-- W6-T3 (audit T2 #15, amendment A8 option A): no plaintext refresh token at rest, 15-minute
-- ceiling, and a single-use marker.
--
-- What was wrong: `startImpersonation()` stored the SUPER ADMIN's own session verbatim in
-- `super_admin_session`, refresh token included. A support tool therefore kept a live, refreshable
-- credential for the highest-privileged account in the system in a plaintext JSON column. The target
-- side never did this (its refresh token is revoked at start), so the asymmetry was accidental rather
-- than intended.
--
-- Three changes, all enforced by the database rather than by convention:
--   1. `super_admin_session` may not contain a refresh token - the same CHECK the target side has.
--   2. The lifetime ceiling drops from 30 to 15 minutes, in the CONSTRAINT too: shortening only the
--      application constant would leave Postgres accepting a 30-minute row, i.e. the code stricter
--      than the schema, which is the shape of gap this audit exists to close.
--   3. `used_at` makes the httpOnly marker single-use for real. `end/route.ts` already claims "the id
--      is dead once used"; nothing enforced it.
--
-- ORDERING, important: this migration must be applied WITH the deploy, not before it. The current
-- production code inserts the actor session WITH its refresh token, so the new CHECK would make
-- impersonation fail until the new code is live. The table holds 0 rows, so the DELETE below is a
-- no-op kept for the amendment's intent: no pre-existing row may keep the old shape.
--
-- ROLLBACK:
--   ALTER TABLE public.impersonation_sessions DROP CONSTRAINT IF EXISTS impersonation_super_admin_session_no_refresh;
--   ALTER TABLE public.impersonation_sessions DROP CONSTRAINT IF EXISTS impersonation_used_requires_ended;
--   ALTER TABLE public.impersonation_sessions DROP CONSTRAINT IF EXISTS impersonation_max_duration;
--   ALTER TABLE public.impersonation_sessions
--     ADD CONSTRAINT impersonation_max_duration CHECK (expires_at <= created_at + interval '00:30:05');
--   ALTER TABLE public.impersonation_sessions DROP COLUMN IF EXISTS used_at;

DELETE FROM public.impersonation_sessions WHERE ended_at IS NULL;

ALTER TABLE public.impersonation_sessions
  ADD COLUMN IF NOT EXISTS used_at timestamp with time zone;

ALTER TABLE public.impersonation_sessions
  ADD CONSTRAINT impersonation_super_admin_session_no_refresh
  CHECK (NOT (super_admin_session ? 'refresh_token'));

ALTER TABLE public.impersonation_sessions DROP CONSTRAINT IF EXISTS impersonation_max_duration;
ALTER TABLE public.impersonation_sessions
  ADD CONSTRAINT impersonation_max_duration
  CHECK (expires_at <= created_at + interval '00:15:05');

-- A consumed marker belongs to a finished impersonation: used_at without ended_at is a bug, not a state.
ALTER TABLE public.impersonation_sessions
  ADD CONSTRAINT impersonation_used_requires_ended
  CHECK (used_at IS NULL OR ended_at IS NOT NULL);
