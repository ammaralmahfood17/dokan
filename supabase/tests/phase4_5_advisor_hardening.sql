BEGIN;

CREATE EXTENSION IF NOT EXISTS pgtap WITH SCHEMA extensions;
SELECT plan(10);

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
  NOT has_function_privilege('anon', 'public.orders_validate_amount_on_insert()', 'EXECUTE'),
  'anon cannot invoke the amount-validation trigger function'
);
SELECT ok(
  NOT has_function_privilege('authenticated', 'public.orders_validate_amount_on_insert()', 'EXECUTE'),
  'authenticated cannot invoke the amount-validation trigger function'
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
