-- ============================================================================
-- Table sessions — closing the remaining gaps (phase A/B polish, 2026-10-23)
-- ============================================================================
--
-- 1. mark_order_paid(): collecting ONE order out of a table's session. Until
--    now `collect_table_session` was all-or-nothing, so a customer paying cash
--    for their own order could not be recorded without marking the whole table
--    paid. Same posture as the session-level RPC: forward-only (`paid_at IS
--    NULL`), member-only, audited.
--
-- 2. table_board() gains the LAST CLOSED session per table. The floor needs to
--    say «أُغلق آليًا» after the 8-hour sweep — otherwise a table that closed
--    itself overnight is indistinguishable from one a colleague closed
--    correctly.
--
-- The return type of table_board changes, and `create or replace` cannot change
-- a return type, so it is dropped and recreated (its two grants with it).
-- Nothing else depends on it yet: no view, no policy.
-- ============================================================================

CREATE OR REPLACE FUNCTION public.mark_order_paid(p_order_id uuid)
RETURNS jsonb
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public, pg_temp
AS $$
DECLARE
  v_order public.orders%ROWTYPE;
BEGIN
  SELECT * INTO v_order FROM public.orders WHERE id = p_order_id FOR UPDATE;
  IF NOT FOUND THEN
    RAISE EXCEPTION 'ORDER_NOT_FOUND' USING ERRCODE = 'no_data_found';
  END IF;
  IF NOT public.is_project_member(v_order.project_id) THEN
    RAISE EXCEPTION 'NOT_AUTHORIZED' USING ERRCODE = 'insufficient_privilege';
  END IF;
  IF v_order.service_type IS NOT NULL THEN
    -- «نادِ النادل» / «الفاتورة» rows live in orders with a zero total; marking
    -- one paid would write a payment fact that does not exist.
    RAISE EXCEPTION 'NOT_A_CONSUMPTION_ORDER' USING ERRCODE = 'check_violation';
  END IF;
  IF v_order.status = 'cancelled' THEN
    RAISE EXCEPTION 'ORDER_CANCELLED' USING ERRCODE = 'check_violation';
  END IF;

  IF v_order.paid_at IS NOT NULL THEN
    RETURN jsonb_build_object('id', v_order.id, 'paid_at', v_order.paid_at,
                              'amount', v_order.total_amount, 'already_paid', true);
  END IF;

  UPDATE public.orders SET paid_at = now() WHERE id = p_order_id
  RETURNING paid_at INTO v_order.paid_at;

  INSERT INTO public.order_audit_logs (order_id, project_id, event, actor_user_id, metadata)
  VALUES (p_order_id, v_order.project_id, 'payment_collected', auth.uid(),
          jsonb_build_object('amount', v_order.total_amount, 'scope', 'order',
                             'session_id', v_order.session_id));

  RETURN jsonb_build_object('id', v_order.id, 'paid_at', v_order.paid_at,
                            'amount', v_order.total_amount, 'already_paid', false);
END $$;

REVOKE ALL ON FUNCTION public.mark_order_paid(uuid) FROM PUBLIC;
GRANT EXECUTE ON FUNCTION public.mark_order_paid(uuid) TO authenticated;

DROP FUNCTION IF EXISTS public.table_board(uuid);

CREATE FUNCTION public.table_board(p_project_id uuid)
RETURNS TABLE (
  table_id uuid, number integer, slug text, zone text, seats smallint,
  is_active boolean, session_id uuid, opened_at timestamptz,
  bill_requested_at timestamptz, orders_count integer, active_orders integer,
  total_amount numeric, paid_amount numeric, unpaid_amount numeric,
  last_closed_at timestamptz, last_closed_automatically boolean
)
LANGUAGE sql
STABLE
SECURITY DEFINER
SET search_path = public, pg_temp
AS $$
  SELECT
    t.id, t.number, t.slug, t.zone, t.seats, t.is_active,
    s.id, s.opened_at, s.bill_requested_at,
    COALESCE(o.orders_count, 0)::integer,
    COALESCE(o.active_orders, 0)::integer,
    COALESCE(o.total_amount, 0)::numeric,
    COALESCE(o.paid_amount, 0)::numeric,
    COALESCE(o.unpaid_amount, 0)::numeric,
    lc.closed_at, lc.closed_automatically
  FROM public.tables t
  LEFT JOIN public.table_sessions s
    ON s.table_id = t.id AND s.closed_at IS NULL
  LEFT JOIN LATERAL (
    SELECT
      count(*) FILTER (WHERE status <> 'cancelled') AS orders_count,
      count(*) FILTER (WHERE status IN ('pending','preparing','ready')) AS active_orders,
      sum(total_amount) FILTER (WHERE status <> 'cancelled') AS total_amount,
      sum(total_amount) FILTER (WHERE status <> 'cancelled' AND paid_at IS NOT NULL) AS paid_amount,
      sum(total_amount) FILTER (WHERE status <> 'cancelled' AND paid_at IS NULL) AS unpaid_amount
    FROM public.orders
    WHERE session_id = s.id AND service_type IS NULL
  ) o ON true
  LEFT JOIN LATERAL (
    SELECT ts.closed_at, ts.closed_automatically
    FROM public.table_sessions ts
    WHERE ts.table_id = t.id AND ts.closed_at IS NOT NULL
    ORDER BY ts.closed_at DESC
    LIMIT 1
  ) lc ON true
  WHERE t.project_id = p_project_id
    AND public.is_project_member(p_project_id)
  ORDER BY t.number;
$$;

REVOKE ALL ON FUNCTION public.table_board(uuid) FROM PUBLIC;
GRANT EXECUTE ON FUNCTION public.table_board(uuid) TO authenticated;

CREATE INDEX IF NOT EXISTS table_sessions_last_closed
  ON public.table_sessions (table_id, closed_at DESC)
  WHERE closed_at IS NOT NULL;
