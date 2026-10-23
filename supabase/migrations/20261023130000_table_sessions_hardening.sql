-- ============================================================================
-- Table sessions — hardening found by CI on the first push (2026-10-23)
-- ============================================================================
--
-- 20261023120000_table_sessions.sql was applied to production and made three
-- standing structural assertions fail on a FRESH database:
--
--   * phase12 #7 — every function in `public` must have no PUBLIC (=X) EXECUTE
--     entry except the one documented pre-auth read. The three trigger
--     functions were created with the default PUBLIC grant, i.e. any role could
--     call them directly. A trigger function is executed as the trigger's
--     owner, so revoking EXECUTE breaks nothing.
--
--   * phase7 #5 — every foreign key needs a covering first-column index. The
--     two audit columns (opened_by / closed_by) had none, and the partial unique
--     index on table_id only covers OPEN sessions, while the FK check looks at
--     every row (a table cannot be deleted while ANY session references it).
--
-- Additive and idempotent: two REVOKEs and three indexes.
-- ============================================================================

REVOKE ALL ON FUNCTION public.orders_session_table_match() FROM PUBLIC;
REVOKE ALL ON FUNCTION public.attach_order_session() FROM PUBLIC;
REVOKE ALL ON FUNCTION public.touch_bill_requested() FROM PUBLIC;

-- Full index (not partial): the FK from table_sessions.table_id to tables.id is
-- checked against every row, and sessions accumulate history as they close.
CREATE INDEX IF NOT EXISTS table_sessions_table_id_idx
  ON public.table_sessions (table_id);

CREATE INDEX IF NOT EXISTS table_sessions_opened_by_idx
  ON public.table_sessions (opened_by) WHERE opened_by IS NOT NULL;

CREATE INDEX IF NOT EXISTS table_sessions_closed_by_idx
  ON public.table_sessions (closed_by) WHERE closed_by IS NOT NULL;
