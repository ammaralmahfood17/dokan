-- ============================================================================
-- Table sessions («جلسة طاولة») — Phase A of the floor-plan / occupancy work
-- 2026-10-23
-- ============================================================================
--
-- WHY THIS EXISTS. The merchant asked for a live floor plan where a table
-- becomes busy when the first QR order arrives, several customers can order on
-- the same table (the staff must see ONE running total), and the table only
-- becomes free when a STAFF MEMBER closes it.
--
-- That last rule cannot be derived from order statuses: the archived floor plan
-- computed `occupied = orders.status in (pending, preparing, ready)`, so the
-- kitchen tapping «تم التسليم» freed the table with nobody at it. The state has
-- to be an explicit row:
--
--     busy  = an open table_sessions row
--     free  = none
--
-- The partial unique index below is the whole guarantee: two simultaneous QR
-- scans cannot open two sessions for one table, and no client gets to decide.
--
-- DESIGN DECISIONS (locked with the owner 2026-10-23):
--   1. Closing: owner or any staff member of the project. Kitchen is read-only.
--   2. Closing a table with active orders: WARN + mandatory reason, never a
--      hard block (a customer can walk out).
--   3. The running total is the whole session, split paid / unpaid.
--   4. A bill request flips the table to «بانتظار الفاتورة» automatically.
--   5. A session open more than 8 hours is closed by cron, flagged
--      `closed_automatically` — the orders are NOT touched.
--
-- MONEY NOTE. `orders` had no payment tracking before this migration. The
-- paid/unpaid split forces `paid_at`, and that is a money write: it is only
-- reachable through collect_table_session() (marking, never un-marking), is
-- idempotent by `paid_at is null`, and writes an order_audit_logs row.
-- ============================================================================

-- ----------------------------------------------------------------------------
-- 1. Floor coordinates (restored from the 2026-10-13 build, reverted with it).
--    Nullable, NULL = "not placed" — every existing row is NULL so nothing on
--    screen changes until the merchant drags a table.
-- ----------------------------------------------------------------------------
ALTER TABLE public.tables
  ADD COLUMN IF NOT EXISTS pos_x smallint,
  ADD COLUMN IF NOT EXISTS pos_y smallint,
  ADD COLUMN IF NOT EXISTS seats smallint,
  ADD COLUMN IF NOT EXISTS zone text;

DO $$
BEGIN
  IF NOT EXISTS (SELECT 1 FROM pg_constraint WHERE conname = 'tables_seats_check') THEN
    ALTER TABLE public.tables
      ADD CONSTRAINT tables_seats_check CHECK (seats IS NULL OR (seats > 0 AND seats <= 999));
  END IF;

  IF NOT EXISTS (SELECT 1 FROM pg_constraint WHERE conname = 'tables_zone_len_check') THEN
    ALTER TABLE public.tables
      ADD CONSTRAINT tables_zone_len_check CHECK (zone IS NULL OR char_length(btrim(zone)) BETWEEN 1 AND 40);
  END IF;

  IF NOT EXISTS (SELECT 1 FROM pg_constraint WHERE conname = 'tables_pos_check') THEN
    -- 0..1000 abstract grid, never pixels: the canvas maps it to any device.
    ALTER TABLE public.tables
      ADD CONSTRAINT tables_pos_check
      CHECK ((pos_x IS NULL AND pos_y IS NULL)
             OR (pos_x BETWEEN 0 AND 1000 AND pos_y BETWEEN 0 AND 1000));
  END IF;

  IF NOT EXISTS (SELECT 1 FROM pg_constraint WHERE conname = 'tables_pos_pair_check') THEN
    -- Half a coordinate is a bug, not a position.
    ALTER TABLE public.tables
      ADD CONSTRAINT tables_pos_pair_check
      CHECK ((pos_x IS NULL) = (pos_y IS NULL));
  END IF;
END $$;

-- ----------------------------------------------------------------------------
-- 2. table_sessions
-- ----------------------------------------------------------------------------
CREATE TABLE IF NOT EXISTS public.table_sessions (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  project_id uuid NOT NULL REFERENCES public.projects(id) ON DELETE CASCADE,
  table_id uuid NOT NULL REFERENCES public.tables(id) ON DELETE RESTRICT,
  opened_at timestamptz NOT NULL DEFAULT now(),
  -- NULL = opened by the customer's QR scan (the public order path runs as
  -- service_role and has no auth.uid()).
  opened_by uuid REFERENCES auth.users(id),
  closed_at timestamptz,
  closed_by uuid REFERENCES auth.users(id),
  close_reason text,
  closed_automatically boolean NOT NULL DEFAULT false,
  -- Set by the service_requests trigger when a «طلب فاتورة» arrives.
  bill_requested_at timestamptz,
  CONSTRAINT table_sessions_reason_len
    CHECK (close_reason IS NULL OR char_length(btrim(close_reason)) BETWEEN 3 AND 200),
  -- An open session carries no closing facts; a closed one carries exactly one
  -- flavour: by a person (closed_by) or by the 8-hour sweep (automatic).
  CONSTRAINT table_sessions_closed_shape CHECK (
    (closed_at IS NULL AND closed_by IS NULL AND close_reason IS NULL AND closed_automatically = false)
    OR
    (closed_at IS NOT NULL AND (
       (closed_automatically = true AND closed_by IS NULL)
       OR (closed_automatically = false AND closed_by IS NOT NULL)
    ))
  ),
  -- The composite key lets `orders` prove session and project together.
  CONSTRAINT table_sessions_id_project_key UNIQUE (id, project_id)
);

-- THE invariant: at most one open session per table, enforced by the database
-- rather than by a `select` before `insert` in application code.
CREATE UNIQUE INDEX IF NOT EXISTS table_sessions_one_open
  ON public.table_sessions (table_id) WHERE closed_at IS NULL;

CREATE INDEX IF NOT EXISTS table_sessions_project_open
  ON public.table_sessions (project_id, closed_at);

CREATE INDEX IF NOT EXISTS table_sessions_table_history
  ON public.table_sessions (table_id, opened_at DESC);

ALTER TABLE public.table_sessions ENABLE ROW LEVEL SECURITY;

-- Read for project members only; there is no write policy on purpose. Rows are
-- created by the order trigger and closed/collected through SECURITY DEFINER
-- RPCs, exactly like `orders`.
REVOKE ALL ON public.table_sessions FROM anon, authenticated;
GRANT SELECT ON public.table_sessions TO authenticated;

DROP POLICY IF EXISTS table_sessions_select_members ON public.table_sessions;
CREATE POLICY table_sessions_select_members ON public.table_sessions
  FOR SELECT TO authenticated
  USING (public.is_project_member(project_id));

-- ----------------------------------------------------------------------------
-- 3. Orders: session link + payment marking
-- ----------------------------------------------------------------------------
ALTER TABLE public.orders
  ADD COLUMN IF NOT EXISTS session_id uuid,
  ADD COLUMN IF NOT EXISTS paid_at timestamptz;

DO $$
BEGIN
  IF NOT EXISTS (SELECT 1 FROM pg_constraint WHERE conname = 'orders_session_project_fk') THEN
    -- MATCH SIMPLE: a NULL session_id (takeaway, service row) skips the check.
    -- A session from another project is a data leak, not a typo.
    ALTER TABLE public.orders
      ADD CONSTRAINT orders_session_project_fk
      FOREIGN KEY (session_id, project_id)
      REFERENCES public.table_sessions (id, project_id)
      ON DELETE SET NULL (session_id);
  END IF;
END $$;

CREATE INDEX IF NOT EXISTS orders_session ON public.orders (session_id)
  WHERE session_id IS NOT NULL;
CREATE INDEX IF NOT EXISTS orders_session_unpaid ON public.orders (session_id)
  WHERE paid_at IS NULL;

-- A session and its orders must agree on the table. Enforced here so a future
-- writer cannot attach an order to somebody else's table.
CREATE OR REPLACE FUNCTION public.orders_session_table_match()
RETURNS trigger
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public, pg_temp
AS $$
DECLARE
  v_table uuid;
BEGIN
  IF NEW.session_id IS NULL THEN
    RETURN NEW;
  END IF;
  SELECT table_id INTO v_table FROM public.table_sessions WHERE id = NEW.session_id;
  IF v_table IS NULL OR v_table <> NEW.table_id THEN
    RAISE EXCEPTION 'SESSION_TABLE_MISMATCH' USING ERRCODE = 'check_violation';
  END IF;
  RETURN NEW;
END $$;

DROP TRIGGER IF EXISTS orders_session_table_match_trg ON public.orders;
CREATE TRIGGER orders_session_table_match_trg
  BEFORE INSERT OR UPDATE OF session_id, table_id ON public.orders
  FOR EACH ROW EXECUTE FUNCTION public.orders_session_table_match();

-- ----------------------------------------------------------------------------
-- 4. Order → session attachment (BEFORE INSERT, so no RPC has to change)
--
--    `create_order_transactional` is the single write path for both the QR
--    route and POS, and it is service_role only. Patching it would mean
--    re-defining a long function that two later migrations also touched;
--    a trigger attaches every insert instead, including future writers, with
--    no chance of one path forgetting. Waiter/bill service rows are excluded:
--    they carry a table_id but are not consumption.
-- ----------------------------------------------------------------------------
CREATE OR REPLACE FUNCTION public.attach_order_session()
RETURNS trigger
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public, pg_temp
AS $$
BEGIN
  IF NEW.session_id IS NULL AND NEW.table_id IS NOT NULL AND NEW.service_type IS NULL THEN
    NEW.session_id := public.ensure_table_session(NEW.project_id, NEW.table_id, NEW.created_at);
  END IF;
  RETURN NEW;
END $$;

DROP TRIGGER IF EXISTS orders_attach_session_trg ON public.orders;
CREATE TRIGGER orders_attach_session_trg
  BEFORE INSERT ON public.orders
  FOR EACH ROW EXECUTE FUNCTION public.attach_order_session();

-- ----------------------------------------------------------------------------
-- 5. RPCs
-- ----------------------------------------------------------------------------

-- Internal: open-or-get the live session for a table. service_role only; the
-- trigger above is its one caller. The row lock on `tables` serialises two
-- simultaneous scans BEFORE the unique index has to arbitrate.
CREATE OR REPLACE FUNCTION public.ensure_table_session(
  p_project_id uuid,
  p_table_id uuid,
  p_opened_at timestamptz DEFAULT now()
)
RETURNS uuid
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public, pg_temp
AS $$
DECLARE
  v_id uuid;
BEGIN
  PERFORM 1 FROM public.tables
   WHERE id = p_table_id AND project_id = p_project_id
   FOR UPDATE;
  IF NOT FOUND THEN
    RAISE EXCEPTION 'TABLE_NOT_FOUND' USING ERRCODE = 'no_data_found';
  END IF;

  INSERT INTO public.table_sessions (project_id, table_id, opened_at)
  VALUES (p_project_id, p_table_id, COALESCE(p_opened_at, now()))
  ON CONFLICT (table_id) WHERE closed_at IS NULL DO NOTHING
  RETURNING id INTO v_id;

  IF v_id IS NULL THEN
    SELECT id INTO v_id
      FROM public.table_sessions
     WHERE table_id = p_table_id AND closed_at IS NULL;
  END IF;

  RETURN v_id;
END $$;

REVOKE ALL ON FUNCTION public.ensure_table_session(uuid, uuid, timestamptz) FROM PUBLIC;
GRANT EXECUTE ON FUNCTION public.ensure_table_session(uuid, uuid, timestamptz) TO service_role;

-- Staff-only close. Returns the session plus the numbers the UI needs to say
-- «كانت فيها N طلبات لم تُسلَّم».
CREATE OR REPLACE FUNCTION public.close_table_session(
  p_session_id uuid,
  p_reason text DEFAULT NULL,
  p_force boolean DEFAULT false
)
RETURNS jsonb
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public, pg_temp
AS $$
DECLARE
  v_session public.table_sessions%ROWTYPE;
  v_active integer;
  v_reason text := nullif(btrim(coalesce(p_reason, '')), '');
BEGIN
  SELECT * INTO v_session FROM public.table_sessions WHERE id = p_session_id FOR UPDATE;
  IF NOT FOUND THEN
    RAISE EXCEPTION 'SESSION_NOT_FOUND' USING ERRCODE = 'no_data_found';
  END IF;
  IF NOT public.is_project_member(v_session.project_id) THEN
    RAISE EXCEPTION 'NOT_AUTHORIZED' USING ERRCODE = 'insufficient_privilege';
  END IF;

  IF v_session.closed_at IS NOT NULL THEN
    RETURN jsonb_build_object(
      'id', v_session.id, 'closed_at', v_session.closed_at,
      'closed_by', v_session.closed_by, 'already_closed', true,
      'closed_automatically', v_session.closed_automatically
    );
  END IF;

  SELECT count(*) INTO v_active
    FROM public.orders
   WHERE session_id = p_session_id
     AND status IN ('pending', 'preparing', 'ready')
     AND service_type IS NULL;

  IF v_active > 0 AND NOT p_force THEN
    RAISE EXCEPTION 'TABLE_HAS_ACTIVE_ORDERS:%', v_active USING ERRCODE = 'check_violation';
  END IF;
  IF v_active > 0 AND v_reason IS NULL THEN
    RAISE EXCEPTION 'REASON_REQUIRED' USING ERRCODE = 'check_violation';
  END IF;

  UPDATE public.table_sessions
     SET closed_at = now(),
         closed_by = auth.uid(),
         closed_automatically = false,
         close_reason = v_reason
   WHERE id = p_session_id
   RETURNING * INTO v_session;

  RETURN jsonb_build_object(
    'id', v_session.id, 'closed_at', v_session.closed_at, 'closed_by', v_session.closed_by,
    'active_orders', v_active, 'already_closed', false, 'closed_automatically', false
  );
END $$;

REVOKE ALL ON FUNCTION public.close_table_session(uuid, text, boolean) FROM PUBLIC;
GRANT EXECUTE ON FUNCTION public.close_table_session(uuid, text, boolean) TO authenticated;

-- Marks every unpaid, non-cancelled consumption order of the session as paid.
-- Forward-only and idempotent: `paid_at IS NULL` in the WHERE is the guard, so a
-- double tap cannot double-count and no API can un-pay an order.
CREATE OR REPLACE FUNCTION public.collect_table_session(p_session_id uuid)
RETURNS jsonb
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public, pg_temp
AS $$
DECLARE
  v_project uuid;
  v_count integer := 0;
  v_amount numeric := 0;
  r record;
BEGIN
  SELECT project_id INTO v_project FROM public.table_sessions WHERE id = p_session_id;
  IF v_project IS NULL THEN
    RAISE EXCEPTION 'SESSION_NOT_FOUND' USING ERRCODE = 'no_data_found';
  END IF;
  IF NOT public.is_project_member(v_project) THEN
    RAISE EXCEPTION 'NOT_AUTHORIZED' USING ERRCODE = 'insufficient_privilege';
  END IF;

  FOR r IN
    UPDATE public.orders
       SET paid_at = now()
     WHERE session_id = p_session_id
       AND paid_at IS NULL
       AND status <> 'cancelled'
       AND service_type IS NULL
    RETURNING id, total_amount
  LOOP
    v_count := v_count + 1;
    v_amount := v_amount + COALESCE(r.total_amount, 0);
    INSERT INTO public.order_audit_logs (order_id, project_id, event, actor_user_id, metadata)
    VALUES (r.id, v_project, 'payment_collected', auth.uid(),
            jsonb_build_object('amount', r.total_amount, 'session_id', p_session_id));
  END LOOP;

  RETURN jsonb_build_object('marked', v_count, 'amount', v_amount);
END $$;

REVOKE ALL ON FUNCTION public.collect_table_session(uuid) FROM PUBLIC;
GRANT EXECUTE ON FUNCTION public.collect_table_session(uuid) TO authenticated;

-- ONE query behind every surface (floor plan, POS picker, kitchen strip). The
-- totals live here so no client sums money in JavaScript.
CREATE OR REPLACE FUNCTION public.table_board(p_project_id uuid)
RETURNS TABLE (
  table_id uuid, number integer, slug text, zone text, seats smallint,
  is_active boolean, session_id uuid, opened_at timestamptz,
  bill_requested_at timestamptz, orders_count integer, active_orders integer,
  total_amount numeric, paid_amount numeric, unpaid_amount numeric
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
    COALESCE(o.unpaid_amount, 0)::numeric
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
  WHERE t.project_id = p_project_id
    AND public.is_project_member(p_project_id)
  ORDER BY t.number;
$$;

REVOKE ALL ON FUNCTION public.table_board(uuid) FROM PUBLIC;
GRANT EXECUTE ON FUNCTION public.table_board(uuid) TO authenticated;

-- 8-hour sweep. Deliberately does NOT touch orders: they stay on the kitchen
-- board, and the closed session is the record that the table was forgotten.
CREATE OR REPLACE FUNCTION public.auto_close_stale_sessions()
RETURNS integer
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public, pg_temp
AS $$
DECLARE
  v_count integer;
BEGIN
  WITH stale AS (
    UPDATE public.table_sessions
       SET closed_at = now(),
           closed_by = NULL,
           closed_automatically = true,
           close_reason = 'إغلاق آلي — تجاوزت الجلسة 8 ساعات'
     WHERE closed_at IS NULL
       AND opened_at < now() - interval '8 hours'
    RETURNING 1
  )
  SELECT count(*) INTO v_count FROM stale;
  RETURN v_count;
END $$;

REVOKE ALL ON FUNCTION public.auto_close_stale_sessions() FROM PUBLIC;

-- ----------------------------------------------------------------------------
-- 6. «طلب فاتورة» → بانتظار الفاتورة
--    The bill request is written to service_requests (not orders), so the
--    trigger lives on that table and works for every writer.
-- ----------------------------------------------------------------------------
CREATE OR REPLACE FUNCTION public.touch_bill_requested()
RETURNS trigger
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public, pg_temp
AS $$
BEGIN
  IF NEW.type = 'bill' AND NEW.table_id IS NOT NULL THEN
    UPDATE public.table_sessions
       SET bill_requested_at = now()
     WHERE table_id = NEW.table_id
       AND closed_at IS NULL
       AND bill_requested_at IS NULL;
  END IF;
  RETURN NEW;
END $$;

DROP TRIGGER IF EXISTS service_requests_bill_touch_session ON public.service_requests;
CREATE TRIGGER service_requests_bill_touch_session
  AFTER INSERT ON public.service_requests
  FOR EACH ROW
  WHEN (NEW.type = 'bill')
  EXECUTE FUNCTION public.touch_bill_requested();

-- ----------------------------------------------------------------------------
-- 7. Audit vocabulary + realtime + cron
-- ----------------------------------------------------------------------------
DO $$
BEGIN
  ALTER TABLE public.order_audit_logs DROP CONSTRAINT IF EXISTS order_audit_logs_event_check;
  ALTER TABLE public.order_audit_logs
    ADD CONSTRAINT order_audit_logs_event_check
    CHECK (event = ANY (ARRAY['created','status_changed','cancelled','payment_collected']));
END $$;

DO $$
BEGIN
  IF NOT EXISTS (
    SELECT 1 FROM pg_publication_tables
    WHERE pubname = 'supabase_realtime' AND schemaname = 'public' AND tablename = 'table_sessions'
  ) THEN
    ALTER PUBLICATION supabase_realtime ADD TABLE public.table_sessions;
  END IF;
END $$;

-- Hourly at :07 — offset from the 03:00 subscription sweep so the two never
-- queue behind each other on a small instance.
DO $$
BEGIN
  IF EXISTS (SELECT 1 FROM cron.job WHERE jobname = 'auto-close-table-sessions') THEN
    PERFORM cron.unschedule('auto-close-table-sessions');
  END IF;
  PERFORM cron.schedule(
    'auto-close-table-sessions',
    '7 * * * *',
    $cron$ SELECT public.auto_close_stale_sessions(); $cron$
  );
END $$;
