BEGIN;

CREATE EXTENSION IF NOT EXISTS pgtap WITH SCHEMA extensions;
-- 10 -> 8 (migration 20261016122000): the two assertions for
-- public.orders_validate_amount_on_insert() are removed because the function is gone. The trigger
-- only ever fired for service_role (the sole role that can insert an order) and made the order RPC
-- fail with a misleading message for anyone else — the boundary that remains is the absent INSERT
-- grant on orders/order_items, asserted in phase1_inventory.sql.
SELECT plan(8);

SELECT ok(
  NOT has_function_privilege('anon', 'public.order_items_validate_project()', 'EXECUTE'),
  'anon cannot invoke the order-item trigger function'
);
SELECT ok(
  NOT has_function_privilege('authenticated', 'public.order_items_validate_project()', 'EXECUTE'),
  'authenticated cannot invoke the order-item trigger function'
);
SELECT ok(
  NOT has_function_privilege('anon', 'public.orders_auto_number()', 'EXECUTE'),
  'anon cannot invoke the order-number trigger function'
);
SELECT ok(
  NOT has_function_privilege('authenticated', 'public.orders_auto_number()', 'EXECUTE'),
  'authenticated cannot invoke the order-number trigger function'
);
SELECT ok(
  EXISTS (
    SELECT 1
      FROM pg_proc p
      JOIN pg_namespace n ON n.oid = p.pronamespace
     WHERE n.nspname = 'public'
       AND p.proname = 'purge_web_vitals'
       AND p.proconfig @> ARRAY['search_path=public']
  ),
  'web-vitals retention has a fixed search path'
);
SELECT is(
  (SELECT count(*)::integer
     FROM pg_indexes
    WHERE schemaname = 'public'
      AND indexname IN (
        'idx_orders_table_id',
        'idx_products_category_id',
        'idx_service_requests_table_id',
        'idx_telegram_links_user_id'
      )),
  4,
  'all foreign-key indexes exist'
);
SELECT is(
  (SELECT count(*)::integer
     FROM pg_policies
    WHERE schemaname = 'public'
      AND tablename = 'staff_members'
      AND cmd = 'INSERT'
      AND 'authenticated' = ANY (roles)),
  1,
  'staff insert authorization uses one policy'
);
SELECT ok(
  (SELECT bool_and(coalesce(qual, with_check) LIKE '%( SELECT auth.uid()%')
     FROM pg_policies
    WHERE schemaname = 'public'
      AND tablename = 'subscription_payments'),
  'subscription payment policies cache auth.uid per statement'
);

SELECT * FROM finish();
ROLLBACK;
