-- 20261006094000_qr_reprint_flag.sql
--
-- Owner decision 1 (2026-10-06 audit remediation): the merchant must reprint the table QR
-- sheets, because the new sheets carry the table's 128-bit scan token in `?k=` and the old
-- ones do not. Until tokenless orders stop arriving, REQUIRE_TABLE_TOKEN stays false (the
-- flip is driven by 48h of token_present=false telemetry, never by a date).
--
-- This column records that the merchant has dealt with it — set when they print the sheet
-- or dismiss the banner. Per PROJECT, so it survives devices and is visible to the server.
--
-- NOTE the grant below is additive on purpose: 0013_column-scoped UPDATE to
-- (name, currency, primary_color, is_active) and revoked the table-level UPDATE. A new
-- column is therefore NOT writable until it is granted explicitly — without this line the
-- banner's dismiss would silently update zero rows.
--
-- ROLLBACK:
--   REVOKE UPDATE (qr_reprinted_at) ON public.projects FROM authenticated;
--   ALTER TABLE public.projects DROP COLUMN IF EXISTS qr_reprinted_at;

ALTER TABLE public.projects
  ADD COLUMN IF NOT EXISTS qr_reprinted_at timestamptz;

COMMENT ON COLUMN public.projects.qr_reprinted_at IS
  'When the merchant reprinted the table QR sheets (or dismissed the reprint banner). NULL = still pending. Audit 2026-10-06, owner decision 1.';

GRANT UPDATE (qr_reprinted_at) ON public.projects TO authenticated;

DO $$
BEGIN
  IF NOT has_column_privilege('authenticated', 'public.projects', 'qr_reprinted_at', 'UPDATE') THEN
    RAISE EXCEPTION 'assertion failed: authenticated cannot set qr_reprinted_at — the banner could never persist';
  END IF;
  -- The entitlement columns must still be unavailable; adding a column must not have widened
  -- the grant surface (0013 + 0003 established this).
  IF has_column_privilege('authenticated', 'public.projects', 'subscription_expires_at', 'UPDATE') THEN
    RAISE EXCEPTION 'assertion failed: subscription_expires_at became updatable by authenticated';
  END IF;
END $$;
