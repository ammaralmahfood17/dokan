-- Race conditions the single-session pgTAP files cannot express.
--
-- Two invariants need TWO real backends:
--   A. two orders racing for the LAST unit of an ingredient -> exactly one succeeds, the loser
--      gets OUT_OF_INGREDIENT_STOCK, exactly one order row and one consume movement survive;
--   B. two concurrent submits with the SAME idempotency key -> one insert, one replay, one row.
--
-- dblink is used because a second backend has its own transaction and therefore cannot see
-- uncommitted rows — so the seed below is committed on purpose and removed at the end.
--
-- Connection probing: dblink runs INSIDE the database server, so the host-published port is
-- useless there (`supabase start` publishes 54322 on the host while the server listens on 5432).
-- The candidates are therefore the server's own port first, then 5432/54322, on 127.0.0.1 and on
-- the server's own address. `race.host` / `race.port` / `race.user` / `race.password` GUCs can
-- pin it explicitly.
--
-- If no second backend can be opened the assertions are SKIPPED with the reason (visible in the
-- TAP output) instead of failing: a missing dblink must never break CI.

CREATE EXTENSION IF NOT EXISTS pgtap WITH SCHEMA extensions;
DO $init$ BEGIN
  BEGIN
    CREATE EXTENSION IF NOT EXISTS dblink WITH SCHEMA extensions;
  EXCEPTION WHEN OTHERS THEN NULL;  -- reported by the skip path below
  END;
END $init$;

SELECT plan(7);

-- ── seed (committed on purpose: the dblink backends must see it) ───────────────────────────────
DELETE FROM public.projects WHERE id = 'd1400000-0000-0000-0000-000000000001';
DELETE FROM auth.users WHERE id = 'a1400000-0000-0000-0000-000000000001';

INSERT INTO auth.users (
  instance_id, id, aud, role, email, encrypted_password,
  email_confirmed_at, raw_app_meta_data, raw_user_meta_data, created_at, updated_at
) VALUES (
  '00000000-0000-0000-0000-000000000000',
  'a1400000-0000-0000-0000-000000000001',
  'authenticated', 'authenticated', 'race-owner@example.test', '', now(),
  '{"provider":"email","providers":["email"],"provisioned_by":"dokan-admin-api"}', '{}', now(), now()
);

INSERT INTO public.projects (id, name, slug, currency, primary_color, is_active, created_by)
VALUES ('d1400000-0000-0000-0000-000000000001', 'Race Test', 'race-test', 'BHD', '#4338CA', false,
        'a1400000-0000-0000-0000-000000000001');

INSERT INTO public.staff_members (project_id, user_id, role)
VALUES ('d1400000-0000-0000-0000-000000000001', 'a1400000-0000-0000-0000-000000000001', 'owner');

INSERT INTO public.products (id, project_id, name, price, stock, is_available) VALUES
  ('e1400000-0000-0000-0000-000000000001', 'd1400000-0000-0000-0000-000000000001', 'Race Meal A', 1.000, NULL, true),
  ('e1400000-0000-0000-0000-000000000002', 'd1400000-0000-0000-0000-000000000001', 'Race Meal B', 1.000, NULL, true);

INSERT INTO public.ingredients (id, project_id, name, unit, quantity_on_hand, reorder_point) VALUES
  ('f1400000-0000-0000-0000-000000000001', 'd1400000-0000-0000-0000-000000000001', 'Last Unit', 'g', 1, 0),
  ('f1400000-0000-0000-0000-000000000002', 'd1400000-0000-0000-0000-000000000001', 'Plenty', 'g', 100, 0);

INSERT INTO public.product_ingredients (project_id, product_id, ingredient_id, quantity_per_product) VALUES
  ('d1400000-0000-0000-0000-000000000001', 'e1400000-0000-0000-0000-000000000001', 'f1400000-0000-0000-0000-000000000001', 1),
  ('d1400000-0000-0000-0000-000000000001', 'e1400000-0000-0000-0000-000000000002', 'f1400000-0000-0000-0000-000000000002', 1);

CREATE TEMP TABLE race_env (connected boolean, reason text);
CREATE TEMP TABLE race_a (outcome text);
CREATE TEMP TABLE race_b (result jsonb);
INSERT INTO race_env VALUES (false, 'not attempted');

-- ── drive both races ───────────────────────────────────────────────────────────────────────────
DO $race$
DECLARE
  v_hosts text[];
  v_ports text[];
  v_host  text;
  v_port  text;
  v_h     text;
  v_p     text;
  v_ok    boolean := false;
  v_res   jsonb;
  v_err   text := 'no candidate worked';
  i       int;
BEGIN
  v_hosts := ARRAY[coalesce(current_setting('race.host', true), '127.0.0.1')];
  IF inet_server_addr() IS NOT NULL AND inet_server_addr()::text <> '127.0.0.1' THEN
    v_hosts := v_hosts || inet_server_addr()::text;
  END IF;

  v_ports := ARRAY[coalesce(current_setting('race.port', true), inet_server_port()::text)];
  v_ports := v_ports || ARRAY['5432', '54322'];

  FOREACH v_host IN ARRAY v_hosts LOOP
    FOREACH v_port IN ARRAY v_ports LOOP
      BEGIN
        PERFORM dblink_connect('race1', format(
          'host=%s port=%s dbname=%s user=%s password=%s',
          v_host, v_port, current_database(),
          coalesce(current_setting('race.user', true), current_user),
          coalesce(current_setting('race.password', true), 'postgres')));
        PERFORM dblink_connect('race2', format(
          'host=%s port=%s dbname=%s user=%s password=%s',
          v_host, v_port, current_database(),
          coalesce(current_setting('race.user', true), current_user),
          coalesce(current_setting('race.password', true), 'postgres')));
        v_ok := true; v_h := v_host; v_p := v_port;
        EXIT;
      EXCEPTION WHEN OTHERS THEN
        v_err := SQLERRM;
        BEGIN PERFORM dblink_disconnect('race1'); EXCEPTION WHEN OTHERS THEN NULL; END;
        BEGIN PERFORM dblink_disconnect('race2'); EXCEPTION WHEN OTHERS THEN NULL; END;
      END;
    END LOOP;
    EXIT WHEN v_ok;
  END LOOP;

  IF NOT v_ok THEN
    UPDATE race_env SET connected = false, reason = v_err;
    RAISE NOTICE 'race harness: skipped, no second backend after probing (%: %)', v_err, array_to_string(v_ports, ',');
    RETURN;
  END IF;
  RAISE NOTICE 'race harness: second backend at %:%', v_h, v_p;

  BEGIN
    -- ── race A: last unit of stock, different idempotency keys ────────────────────────────────
    FOR i IN 1..2 LOOP
      PERFORM dblink_send_query('race' || i, format($q$
        WITH cfg AS (
          SELECT set_config('request.jwt.claim.sub', 'a1400000-0000-0000-0000-000000000001', false)
               , set_config('request.jwt.claim.role', 'service_role', false)
               , set_config('request.jwt.claims',
                   '{"sub":"a1400000-0000-0000-0000-000000000001","role":"service_role"}', false)
        )
        SELECT public.create_order_transactional(
          'd1400000-0000-0000-0000-000000000001', 'walkin', 'pending', 0, 0,
          '[{"product_id":"e1400000-0000-0000-0000-000000000001","quantity":1,"addons":[]}]'::jsonb,
          NULL, NULL, 'a1400000-0000-0000-0000-000000000001',
          ('c1400000-0000-0000-0000-00000000000' || %s)::uuid
        ) AS result FROM cfg
      $q$, i));
    END LOOP;

    FOR i IN 1..2 LOOP
      BEGIN
        SELECT r INTO v_res FROM dblink_get_result('race' || i) AS t(r jsonb);
        INSERT INTO race_a VALUES ('ok');
      EXCEPTION WHEN OTHERS THEN
        INSERT INTO race_a VALUES (
          CASE WHEN SQLERRM LIKE '%OUT_OF_INGREDIENT_STOCK%' THEN 'out_of_stock'
               ELSE left(SQLERRM, 300) END
        );
      END;
      BEGIN PERFORM dblink_disconnect('race' || i); EXCEPTION WHEN OTHERS THEN NULL; END;
    END LOOP;

    -- ── race B: same idempotency key, plenty of stock ─────────────────────────────────────────
    PERFORM dblink_connect('race1', format(
      'host=%s port=%s dbname=%s user=%s password=%s', v_h, v_p, current_database(),
      coalesce(current_setting('race.user', true), current_user),
      coalesce(current_setting('race.password', true), 'postgres')));
    PERFORM dblink_connect('race2', format(
      'host=%s port=%s dbname=%s user=%s password=%s', v_h, v_p, current_database(),
      coalesce(current_setting('race.user', true), current_user),
      coalesce(current_setting('race.password', true), 'postgres')));

    FOR i IN 1..2 LOOP
      PERFORM dblink_send_query('race' || i, $q$
        WITH cfg AS (
          SELECT set_config('request.jwt.claim.sub', 'a1400000-0000-0000-0000-000000000001', false)
               , set_config('request.jwt.claim.role', 'service_role', false)
               , set_config('request.jwt.claims',
                   '{"sub":"a1400000-0000-0000-0000-000000000001","role":"service_role"}', false)
        )
        SELECT public.create_order_transactional(
          'd1400000-0000-0000-0000-000000000001', 'walkin', 'pending', 0, 0,
          '[{"product_id":"e1400000-0000-0000-0000-000000000002","quantity":1,"addons":[]}]'::jsonb,
          NULL, NULL, 'a1400000-0000-0000-0000-000000000001',
          'c1400000-0000-0000-0000-0000000000ff'
        ) AS result FROM cfg
      $q$);
    END LOOP;

    FOR i IN 1..2 LOOP
      BEGIN
        SELECT r INTO v_res FROM dblink_get_result('race' || i) AS t(r jsonb);
        INSERT INTO race_b VALUES (coalesce(v_res, jsonb_build_object('error', 'no row')));
      EXCEPTION WHEN OTHERS THEN
        INSERT INTO race_b VALUES (jsonb_build_object('error', left(SQLERRM, 300)));
      END;
      BEGIN PERFORM dblink_disconnect('race' || i); EXCEPTION WHEN OTHERS THEN NULL; END;
    END LOOP;

    UPDATE race_env SET connected = true, reason = NULL;
    RAISE NOTICE 'race harness: both races executed';
  EXCEPTION WHEN OTHERS THEN
    v_err := SQLERRM;
    BEGIN PERFORM dblink_disconnect('race1'); EXCEPTION WHEN OTHERS THEN NULL; END;
    BEGIN PERFORM dblink_disconnect('race2'); EXCEPTION WHEN OTHERS THEN NULL; END;
    UPDATE race_env SET connected = false, reason = v_err;
    RAISE NOTICE 'race harness: skipped, no second backend (%)', v_err;
  END;
END
$race$;

-- ── assertions (skipped, visibly, when no second backend was possible) ─────────────────────────
SELECT CASE WHEN connected THEN 1 ELSE 0 END AS race_connected FROM race_env \gset

\if :race_connected
SELECT is((SELECT count(*)::int FROM race_a WHERE outcome = 'ok'), 1,
  'race A: exactly one of two concurrent orders wins the last unit');
SELECT is((SELECT count(*)::int FROM race_a WHERE outcome = 'out_of_stock'), 1,
  'race A: the loser is rejected with OUT_OF_INGREDIENT_STOCK');
SELECT is((SELECT count(*)::int FROM public.orders WHERE project_id = 'd1400000-0000-0000-0000-000000000001'),
  1, 'race A: only one order row exists');
SELECT is((SELECT quantity_on_hand FROM public.ingredients WHERE id = 'f1400000-0000-0000-0000-000000000001'),
  0::numeric, 'race A: the last unit is gone, never negative');
SELECT is((SELECT count(*)::int FROM public.inventory_movements
    WHERE project_id = 'd1400000-0000-0000-0000-000000000001' AND movement_type = 'consume'),
  1, 'race A: exactly one consume movement was written');
SELECT is((SELECT count(*)::int FROM race_b WHERE (result ->> 'replayed')::boolean IS TRUE), 1,
  'race B: one submit replays, the other inserts');
SELECT is((SELECT count(*)::int FROM public.orders
    WHERE project_id = 'd1400000-0000-0000-0000-000000000001'
      AND client_request_id = 'c1400000-0000-0000-0000-0000000000ff'),
  1, 'race B: one idempotency key produced one order row');
\else
SELECT skip('dblink could not open a second backend: ' || coalesce((SELECT reason FROM race_env), '?'), 7);
\endif

-- ── cleanup (the seed was committed so the dblink backends could see it) ──────────────────────
DELETE FROM public.projects WHERE id = 'd1400000-0000-0000-0000-000000000001';
DELETE FROM auth.users WHERE id = 'a1400000-0000-0000-0000-000000000001';

SELECT * FROM finish();
