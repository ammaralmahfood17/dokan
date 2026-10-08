BEGIN;

CREATE EXTENSION IF NOT EXISTS pgtap WITH SCHEMA extensions;
SELECT plan(30);

INSERT INTO auth.users (
  instance_id, id, aud, role, email, encrypted_password,
  email_confirmed_at, raw_app_meta_data, raw_user_meta_data, created_at, updated_at
) VALUES
  ('00000000-0000-0000-0000-000000000000', 'a1000000-0000-0000-0000-000000000001', 'authenticated', 'authenticated', 'inventory-owner@example.test', '', now(), '{"provider":"email","providers":["email"]}', '{}', now(), now()),
  ('00000000-0000-0000-0000-000000000000', 'b1000000-0000-0000-0000-000000000002', 'authenticated', 'authenticated', 'inventory-manager@example.test', '', now(), '{"provider":"email","providers":["email"]}', '{}', now(), now()),
  ('00000000-0000-0000-0000-000000000000', 'c1000000-0000-0000-0000-000000000003', 'authenticated', 'authenticated', 'inventory-staff@example.test', '', now(), '{"provider":"email","providers":["email"]}', '{}', now(), now());

INSERT INTO public.projects (id, name, slug, currency, primary_color, is_active, created_by) VALUES
  ('d1000000-0000-0000-0000-000000000004', 'Inventory Test', 'inventory-test', 'BHD', '#4338CA', true, 'a1000000-0000-0000-0000-000000000001'),
  ('d2000000-0000-0000-0000-000000000005', 'Other Tenant', 'inventory-other', 'BHD', '#4338CA', true, 'a1000000-0000-0000-0000-000000000001');

INSERT INTO public.staff_members (project_id, user_id, role) VALUES
  ('d1000000-0000-0000-0000-000000000004', 'a1000000-0000-0000-0000-000000000001', 'owner'),
  ('d1000000-0000-0000-0000-000000000004', 'b1000000-0000-0000-0000-000000000002', 'manager'),
  ('d1000000-0000-0000-0000-000000000004', 'c1000000-0000-0000-0000-000000000003', 'staff');

INSERT INTO public.products (id, project_id, name, price, stock, is_available) VALUES
  ('e1000000-0000-0000-0000-000000000001', 'd1000000-0000-0000-0000-000000000004', 'Inventory Test Meal', 1.250, 5, true);

INSERT INTO public.ingredients (id, project_id, name, unit, reorder_point)
VALUES ('f1000000-0000-0000-0000-000000000001', 'd2000000-0000-0000-0000-000000000005', 'Private Flour', 'g', 0);

CREATE TEMP TABLE inventory_test_order (result jsonb) ON COMMIT DROP;
CREATE TEMP TABLE inventory_test_replay (result jsonb) ON COMMIT DROP;
CREATE TEMP TABLE inventory_test_movement_count (value integer) ON COMMIT DROP;
GRANT SELECT, INSERT ON inventory_test_order, inventory_test_replay,
  inventory_test_movement_count TO authenticated, service_role;

SELECT ok(
  NOT has_column_privilege('authenticated', 'public.ingredients', 'quantity_on_hand', 'UPDATE'),
  'authenticated users cannot change stock balances directly'
);
SELECT ok(
  NOT has_table_privilege('authenticated', 'public.inventory_movements', 'INSERT'),
  'authenticated users cannot forge movement ledger rows'
);
SELECT ok(
  NOT has_column_privilege('authenticated', 'public.order_items', 'portion_stock_deducted', 'UPDATE'),
  'authenticated users cannot rewrite portion stock audit state'
);

SET LOCAL ROLE authenticated;
SELECT set_config('request.jwt.claim.sub', 'b1000000-0000-0000-0000-000000000002', true);
SELECT set_config('request.jwt.claim.role', 'authenticated', true);
SELECT set_config('request.jwt.claims', '{"sub":"b1000000-0000-0000-0000-000000000002","role":"authenticated"}', true);

SELECT lives_ok(
  $$INSERT INTO public.suppliers (id, project_id, name, email)
    VALUES ('f1000000-0000-0000-0000-000000000010', 'd1000000-0000-0000-0000-000000000004', 'Local Foods', 'orders@example.test')$$,
  'manager can add a project supplier'
);
SELECT lives_ok(
  $$INSERT INTO public.ingredients (id, project_id, name, unit, reorder_point, supplier_id, supplier_sku)
    VALUES ('f1000000-0000-0000-0000-000000000011', 'd1000000-0000-0000-0000-000000000004', 'Flour', 'g', 150, 'f1000000-0000-0000-0000-000000000010', 'FL-01')$$,
  'manager can add an ingredient without setting its balance directly'
);
SELECT lives_ok(
  $$SELECT public.adjust_ingredient_stock('f1000000-0000-0000-0000-000000000011', 'receive', 1000, 'opening delivery')$$,
  'manager can receive stock through the movement RPC'
);
SELECT is(
  (SELECT quantity_on_hand FROM public.ingredients WHERE id = 'f1000000-0000-0000-0000-000000000011'),
  1000::numeric,
  'receipt updates the ingredient balance'
);
SELECT lives_ok(
  $$SELECT public.replace_product_recipe(
    'e1000000-0000-0000-0000-000000000001',
    '[{"ingredient_id":"f1000000-0000-0000-0000-000000000011","quantity":"125"}]'::jsonb
  )$$,
  'manager can set a product recipe'
);
SELECT is(
  (SELECT quantity_per_product FROM public.product_ingredients
    WHERE product_id = 'e1000000-0000-0000-0000-000000000001'
      AND ingredient_id = 'f1000000-0000-0000-0000-000000000011'),
  125::numeric,
  'recipe stores ingredient quantity per product'
);
SELECT throws_ok(
  $$SELECT public.replace_product_recipe(
    'e1000000-0000-0000-0000-000000000001',
    '[{"ingredient_id":"f1000000-0000-0000-0000-000000000001","quantity":"25"}]'::jsonb
  )$$,
  '22023',
  'INVALID_RECIPE_INGREDIENT',
  'recipe cannot reference another tenant ingredient'
);
SELECT is(
  (SELECT count(*)::integer FROM public.ingredients WHERE project_id = 'd2000000-0000-0000-0000-000000000005'),
  0,
  'ingredient rows are isolated between tenants'
);

RESET ROLE;
SET LOCAL ROLE authenticated;
SELECT set_config('request.jwt.claim.sub', 'c1000000-0000-0000-0000-000000000003', true);
SELECT set_config('request.jwt.claim.role', 'authenticated', true);
SELECT set_config('request.jwt.claims', '{"sub":"c1000000-0000-0000-0000-000000000003","role":"authenticated"}', true);
SELECT throws_ok(
  $$SELECT public.adjust_ingredient_stock('f1000000-0000-0000-0000-000000000011', 'receive', 10, NULL)$$,
  '42501',
  'not authorized for this project',
  'staff cannot receive or adjust ingredient stock'
);

RESET ROLE;
SET LOCAL ROLE service_role;
SELECT set_config('request.jwt.claim.sub', 'a1000000-0000-0000-0000-000000000001', true);
SELECT set_config('request.jwt.claim.role', 'service_role', true);
SELECT set_config('request.jwt.claims', '{"sub":"a1000000-0000-0000-0000-000000000001","role":"service_role"}', true);
SELECT lives_ok(
  $$INSERT INTO inventory_test_order
    SELECT public.create_order_transactional(
      'd1000000-0000-0000-0000-000000000004',
      'walkin', 'pending', 0, 0,
      '[{"product_id":"e1000000-0000-0000-0000-000000000001","quantity":2,"addons":[]}]'::jsonb,
      NULL, NULL, 'a1000000-0000-0000-0000-000000000001',
      '91000000-0000-0000-0000-000000000001'
    )$$,
  'order RPC creates an order with an idempotency key'
);
SELECT is(
  (SELECT quantity_on_hand FROM public.ingredients WHERE id = 'f1000000-0000-0000-0000-000000000011'),
  750::numeric,
  'order consumes recipe quantities atomically'
);
SELECT is(
  (SELECT stock FROM public.products WHERE id = 'e1000000-0000-0000-0000-000000000001'),
  3,
  'order still decrements existing portion stock'
);
SELECT is(
  (SELECT count(*)::integer FROM public.inventory_movements
    WHERE order_id = (SELECT (result ->> 'id')::uuid FROM inventory_test_order)
      AND movement_type = 'consume'),
  1,
  'one consume movement is written for the order and ingredient'
);
SELECT lives_ok(
  $$INSERT INTO inventory_test_replay
    SELECT public.create_order_transactional(
      'd1000000-0000-0000-0000-000000000004',
      'walkin', 'pending', 0, 0,
      '[{"product_id":"e1000000-0000-0000-0000-000000000001","quantity":2,"addons":[]}]'::jsonb,
      NULL, NULL, 'a1000000-0000-0000-0000-000000000001',
      '91000000-0000-0000-0000-000000000001'
    )$$,
  'repeated idempotency key returns successfully'
);
SELECT is(
  (SELECT (result ->> 'replayed')::boolean FROM inventory_test_replay),
  true,
  'retry is marked as a replay'
);
SELECT is(
  (SELECT quantity_on_hand FROM public.ingredients WHERE id = 'f1000000-0000-0000-0000-000000000011'),
  750::numeric,
  'retry does not consume stock twice'
);

RESET ROLE;
SET LOCAL ROLE authenticated;
SELECT set_config('request.jwt.claim.sub', 'b1000000-0000-0000-0000-000000000002', true);
SELECT set_config('request.jwt.claim.role', 'authenticated', true);
SELECT set_config('request.jwt.claims', '{"sub":"b1000000-0000-0000-0000-000000000002","role":"authenticated"}', true);
SELECT lives_ok(
  $$SELECT public.advance_order_status(
    (SELECT (result ->> 'id')::uuid FROM inventory_test_order),
    'pending', 'cancelled'
  )$$,
  'manager can cancel an order'
);
SELECT is(
  (SELECT quantity_on_hand FROM public.ingredients WHERE id = 'f1000000-0000-0000-0000-000000000011'),
  1000::numeric,
  'cancellation restores the quantity recorded at order time'
);
SELECT is(
  (SELECT stock FROM public.products WHERE id = 'e1000000-0000-0000-0000-000000000001'),
  5,
  'cancellation restores decremented portion stock'
);
SELECT throws_ok(
  $$SELECT public.advance_order_status(
    (SELECT (result ->> 'id')::uuid FROM inventory_test_order),
    'pending', 'cancelled'
  )$$,
  'P0001',
  'STALE_STATUS: order state changed on another device',
  'a repeated cancellation cannot restore stock twice'
);

RESET ROLE;
-- Seed the legacy order with total_amount 0, not 2.500. orders_validate_amount_on_insert()
-- (0013) recomputes the total from order_items for every role EXCEPT service_role, and it is
-- a BEFORE INSERT trigger - so it fires before the order_items row below can exist for this
-- order, the recomputed sum is necessarily 0, and any non-zero total raises
-- 'total_amount must match order_items sum'. This seeded order never has its total read back
-- (the two assertions on it only check product stock), so 0 loses nothing.
-- phase2_rbac_order_state.sql seeds its order the same way (0.000). The 2.500 this test used
-- to declare was arithmetically right for the 2 x 1.250 item below but structurally
-- unreachable for a BEFORE INSERT seed.
INSERT INTO public.orders (id, project_id, type, status, total_amount, order_number)
VALUES (
  'e2000000-0000-0000-0000-000000000002',
  'd1000000-0000-0000-0000-000000000004',
  'walkin', 'pending', 0.000, 987654
);
INSERT INTO public.order_items (
  order_id, product_id, product_name, quantity, unit_price, addons
) VALUES (
  'e2000000-0000-0000-0000-000000000002',
  'e1000000-0000-0000-0000-000000000001',
  'Inventory Test Meal', 2, 1.250, '[]'::jsonb
);
SET LOCAL ROLE authenticated;
SELECT set_config('request.jwt.claim.sub', 'b1000000-0000-0000-0000-000000000002', true);
SELECT set_config('request.jwt.claim.role', 'authenticated', true);
SELECT set_config('request.jwt.claims', '{"sub":"b1000000-0000-0000-0000-000000000002","role":"authenticated"}', true);
SELECT lives_ok(
  $$SELECT public.advance_order_status('e2000000-0000-0000-0000-000000000002', 'pending', 'cancelled')$$,
  'legacy orders can still be cancelled'
);
SELECT is(
  (SELECT stock FROM public.products WHERE id = 'e1000000-0000-0000-0000-000000000001'),
  5,
  'cancelling a legacy order does not add back stock it never consumed'
);

SELECT lives_ok(
  $$SELECT public.adjust_ingredient_stock('f1000000-0000-0000-0000-000000000011', 'adjustment', -900, 'prepare insufficient-stock test')$$,
  'manager can record a negative reconciliation'
);
RESET ROLE;
SET LOCAL ROLE service_role;
SELECT set_config('request.jwt.claim.sub', 'a1000000-0000-0000-0000-000000000001', true);
SELECT set_config('request.jwt.claim.role', 'service_role', true);
SELECT set_config('request.jwt.claims', '{"sub":"a1000000-0000-0000-0000-000000000001","role":"service_role"}', true);
INSERT INTO inventory_test_movement_count
SELECT count(*)::integer FROM public.inventory_movements
WHERE project_id = 'd1000000-0000-0000-0000-000000000004';
SELECT throws_ok(
  $$SELECT public.create_order_transactional(
    'd1000000-0000-0000-0000-000000000004',
    'walkin', 'pending', 0, 0,
    '[{"product_id":"e1000000-0000-0000-0000-000000000001","quantity":2,"addons":[]}]'::jsonb,
    NULL, NULL, 'a1000000-0000-0000-0000-000000000001',
    '91000000-0000-0000-0000-000000000002'
  )$$,
  'P0001',
  'OUT_OF_INGREDIENT_STOCK: Flour (باقي 100.000 g)',
  'insufficient ingredient stock rejects the whole order'
);
SELECT is(
  (SELECT count(*)::integer FROM public.orders
    WHERE project_id = 'd1000000-0000-0000-0000-000000000004'
      AND client_request_id = '91000000-0000-0000-0000-000000000002'),
  0,
  'failed order leaves no order row'
);
SELECT is(
  (SELECT stock FROM public.products WHERE id = 'e1000000-0000-0000-0000-000000000001'),
  5,
  'failed order does not decrement portion stock'
);
SELECT is(
  (SELECT count(*)::integer FROM public.inventory_movements
    WHERE project_id = 'd1000000-0000-0000-0000-000000000004'),
  (SELECT value FROM inventory_test_movement_count),
  'failed order does not write partial ingredient movements'
);

RESET ROLE;
SELECT * FROM finish();
ROLLBACK;
