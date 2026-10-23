-- phase15_table_sessions.sql — floor plan occupancy (Phase A, 2026-10-23)
--
-- Runs on a FRESH database in CI (`supabase db reset` then `supabase test db`),
-- so it asserts BOTH the schema the migrations create and the behaviour of the
-- session RPCs, using a fixture project it creates and rolls back.
--
-- What is protected:
--   * one open session per table — a unique PARTIAL index, not application code;
--   * orders attach themselves (trigger), so no order path can forget;
--   * closing is member-only, refuses to be silent about active orders, and
--     demands a reason when forced;
--   * money marking is forward-only (paid_at IS NULL) and audited;
--   * the 8-hour sweep closes sessions without touching orders.

BEGIN;

CREATE EXTENSION IF NOT EXISTS pgtap WITH SCHEMA extensions;

SELECT plan(22);

-- ---------------------------------------------------------------------------
-- Structure
-- ---------------------------------------------------------------------------
SELECT has_table('public', 'table_sessions', 'table_sessions exists');

SELECT ok(
  EXISTS (
    SELECT 1 FROM pg_indexes
     WHERE schemaname = 'public' AND indexname = 'table_sessions_one_open'
       AND indexdef LIKE '%UNIQUE%' AND indexdef LIKE '%closed_at IS NULL%'
  ),
  'the one-open-session guarantee is a partial unique index'
);

SELECT has_column('public', 'orders', 'session_id', 'orders carry their session');
SELECT has_column('public', 'orders', 'paid_at', 'orders carry a payment marker');
SELECT has_column('public', 'tables', 'pos_x', 'floor coordinates restored');

SELECT ok(
  EXISTS (SELECT 1 FROM pg_constraint WHERE conname = 'orders_session_project_fk'),
  'an order cannot point at another project''s session'
);

SELECT ok(
  EXISTS (SELECT 1 FROM pg_trigger WHERE tgname = 'orders_attach_session_trg' AND NOT tgisinternal),
  'orders attach to a session by trigger'
);
SELECT ok(
  EXISTS (SELECT 1 FROM pg_trigger WHERE tgname = 'service_requests_bill_touch_session' AND NOT tgisinternal),
  'a bill request reaches the live session'
);
SELECT ok(
  EXISTS (SELECT 1 FROM pg_trigger WHERE tgname = 'orders_session_table_match_trg' AND NOT tgisinternal),
  'a session and its orders must agree on the table'
);

SELECT ok(
  (SELECT relrowsecurity FROM pg_class WHERE oid = 'public.table_sessions'::regclass),
  'RLS is on for table_sessions'
);
SELECT is(
  (SELECT count(*)::int FROM pg_policies
    WHERE schemaname = 'public' AND tablename = 'table_sessions' AND cmd <> 'SELECT'),
  0,
  'table_sessions has no write policy — writes go through RPCs'
);

-- Capability surface: the public menu (anon) must not touch sessions at all.
SELECT ok(
  NOT has_function_privilege('anon', 'public.ensure_table_session(uuid,uuid,timestamp with time zone)', 'EXECUTE'),
  'anon cannot open a session'
);
SELECT ok(
  NOT has_function_privilege('anon', 'public.close_table_session(uuid,text,boolean)', 'EXECUTE'),
  'anon cannot close a session'
);
SELECT ok(
  has_function_privilege('authenticated', 'public.close_table_session(uuid,text,boolean)', 'EXECUTE'),
  'staff (authenticated) can close a session'
);
SELECT ok(
  has_function_privilege('authenticated', 'public.table_board(uuid)', 'EXECUTE'),
  'staff can read the board'
);
SELECT ok(
  NOT has_function_privilege('anon', 'public.table_board(uuid)', 'EXECUTE'),
  'the board is not public'
);

SELECT ok(
  EXISTS (
    SELECT 1 FROM pg_publication_tables
     WHERE pubname = 'supabase_realtime' AND schemaname = 'public' AND tablename = 'table_sessions'
  ),
  'table_sessions is published to realtime'
);

SELECT ok(
  EXISTS (SELECT 1 FROM cron.job WHERE jobname = 'auto-close-table-sessions'),
  'the 8-hour sweep is scheduled'
);

-- Per-order collection (20261023150000): staff can settle one order without
-- closing the table, and the public menu cannot.
SELECT has_function('public', 'mark_order_paid', ARRAY['uuid'], 'per-order payment RPC exists');
SELECT ok(
  has_function_privilege('authenticated', 'public.mark_order_paid(uuid)', 'EXECUTE'),
  'staff can collect one order'
);
SELECT ok(
  NOT has_function_privilege('anon', 'public.mark_order_paid(uuid)', 'EXECUTE'),
  'the public menu cannot mark an order paid'
);

-- ---------------------------------------------------------------------------
-- Behaviour (fixture rolled back at the end)
-- ---------------------------------------------------------------------------
DO $$
DECLARE
  v_user uuid;
  v_project uuid;
  v_table uuid;
  s1 uuid; s2 uuid; s3 uuid; v_session uuid;
  v_res jsonb; v_n integer;
BEGIN
  v_user := public.provision_auth_user('tap-sessions@dokan.test', 'Tap-test-123!', 'TAP', true);

  INSERT INTO public.projects (name, slug, currency, primary_color, is_active)
  VALUES ('TAP Sessions', 'tap-sessions-fixture', 'BHD', '#7047EB', true)
  RETURNING id INTO v_project;

  INSERT INTO public.staff_members (project_id, user_id, role)
  VALUES (v_project, v_user, 'owner');

  INSERT INTO public.tables (project_id, number, slug, is_active, qrcode)
  VALUES (v_project, 1, 'table-1', true, repeat('a', 32))
  RETURNING id INTO v_table;

  s1 := public.ensure_table_session(v_project, v_table, now());
  s2 := public.ensure_table_session(v_project, v_table, now());
  IF s1 IS DISTINCT FROM s2 THEN RAISE EXCEPTION 'ensure_table_session is not idempotent'; END IF;

  INSERT INTO public.orders (project_id, table_id, total_amount, order_number)
  VALUES (v_project, v_table, 1.250, 1)
  RETURNING session_id INTO v_session;
  IF v_session IS DISTINCT FROM s1 THEN RAISE EXCEPTION 'order did not attach to the open session'; END IF;

  PERFORM set_config('request.jwt.claims',
    json_build_object('sub', v_user, 'role', 'authenticated')::text, true);

  BEGIN
    PERFORM public.close_table_session(s1, NULL, false);
    RAISE EXCEPTION 'closing with an active order should have been refused';
  EXCEPTION WHEN check_violation THEN
    IF SQLERRM NOT LIKE 'TABLE_HAS_ACTIVE_ORDERS%' THEN RAISE; END IF;
  END;

  BEGIN
    PERFORM public.close_table_session(s1, ' ', true);
    RAISE EXCEPTION 'forcing a close without a reason should have been refused';
  EXCEPTION WHEN check_violation THEN
    IF SQLERRM <> 'REASON_REQUIRED' THEN RAISE; END IF;
  END;

  v_res := public.close_table_session(s1, 'الزبون خرج', true);
  IF (v_res->>'closed_by')::uuid IS DISTINCT FROM v_user THEN RAISE EXCEPTION 'closed_by is not the caller'; END IF;

  v_res := public.collect_table_session(s1);
  IF (v_res->>'marked')::int <> 1 THEN RAISE EXCEPTION 'collect marked % instead of 1', v_res; END IF;
  v_res := public.collect_table_session(s1);
  IF (v_res->>'marked')::int <> 0 THEN RAISE EXCEPTION 'collect is not idempotent'; END IF;

  -- A closed table accepts a new session, and the sweep only touches 8h+ rows.
  INSERT INTO public.orders (project_id, table_id, total_amount, order_number)
  VALUES (v_project, v_table, 0.500, 2)
  RETURNING session_id INTO s3;
  IF s3 IS NULL OR s3 = s1 THEN RAISE EXCEPTION 'a closed session was reused'; END IF;

  IF public.auto_close_stale_sessions() <> 0 THEN RAISE EXCEPTION 'auto-close touched a fresh session'; END IF;
  UPDATE public.table_sessions SET opened_at = now() - interval '9 hours' WHERE id = s3;
  IF public.auto_close_stale_sessions() <> 1 THEN RAISE EXCEPTION 'auto-close did not close the stale session'; END IF;
  IF NOT (SELECT closed_automatically AND closed_by IS NULL FROM public.table_sessions WHERE id = s3) THEN
    RAISE EXCEPTION 'the automatic flag was not recorded';
  END IF;

  RAISE NOTICE 'behaviour fixture passed';
END $$;

SELECT ok(true, 'session lifecycle behaves as specified');

SELECT * FROM finish();
ROLLBACK;
