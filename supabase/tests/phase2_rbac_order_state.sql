BEGIN;

CREATE EXTENSION IF NOT EXISTS pgtap WITH SCHEMA extensions;
SELECT plan(14);

INSERT INTO auth.users (
  instance_id,
  id,
  aud,
  role,
  email,
  encrypted_password,
  email_confirmed_at,
  raw_app_meta_data,
  raw_user_meta_data,
  created_at,
  updated_at
) VALUES
  ('00000000-0000-0000-0000-000000000000', 'a0000000-0000-0000-0000-000000000001', 'authenticated', 'authenticated', 'phase2-owner@example.test', '', now(), '{"provider":"email","providers":["email"]}', '{}', now(), now()),
  ('00000000-0000-0000-0000-000000000000', 'b0000000-0000-0000-0000-000000000002', 'authenticated', 'authenticated', 'phase2-manager@example.test', '', now(), '{"provider":"email","providers":["email"]}', '{}', now(), now()),
  ('00000000-0000-0000-0000-000000000000', 'c0000000-0000-0000-0000-000000000003', 'authenticated', 'authenticated', 'phase2-staff@example.test', '', now(), '{"provider":"email","providers":["email"]}', '{}', now(), now());

INSERT INTO public.projects (
  id, name, slug, currency, primary_color, is_active, created_by
) VALUES (
  'd0000000-0000-0000-0000-000000000004',
  'Phase 2 RBAC Project',
  'phase-2-rbac-project',
  'BHD',
  '#4338CA',
  true,
  'a0000000-0000-0000-0000-000000000001'
);

INSERT INTO public.staff_members (project_id, user_id, role) VALUES
  ('d0000000-0000-0000-0000-000000000004', 'a0000000-0000-0000-0000-000000000001', 'owner'),
  ('d0000000-0000-0000-0000-000000000004', 'b0000000-0000-0000-0000-000000000002', 'manager'),
  ('d0000000-0000-0000-0000-000000000004', 'c0000000-0000-0000-0000-000000000003', 'staff');

SELECT ok(
  NOT has_table_privilege('authenticated', 'public.orders', 'UPDATE')
  AND NOT has_column_privilege('authenticated', 'public.orders', 'status', 'UPDATE'),
  'authenticated users cannot update orders directly'
);

SELECT ok(
  NOT has_table_privilege('authenticated', 'public.order_items', 'UPDATE')
  AND NOT has_column_privilege('authenticated', 'public.order_items', 'status', 'UPDATE'),
  'authenticated users cannot update order items directly'
);

SET LOCAL ROLE authenticated;
SELECT set_config('request.jwt.claim.sub', 'b0000000-0000-0000-0000-000000000002', true);
SELECT set_config('request.jwt.claim.role', 'authenticated', true);
SELECT set_config('request.jwt.claims', '{"sub":"b0000000-0000-0000-0000-000000000002","role":"authenticated"}', true);

SELECT ok(
  public.has_project_role(
    'd0000000-0000-0000-0000-000000000004',
    ARRAY['owner', 'manager']
  ),
  'manager matches catalog-management roles'
);

SELECT lives_ok(
  $$INSERT INTO public.categories (id, project_id, name, sort_order, is_active)
    VALUES ('f0000000-0000-0000-0000-000000000006', 'd0000000-0000-0000-0000-000000000004', 'Manager category', 0, true)$$,
  'manager can create a category'
);

UPDATE public.projects
   SET name = 'Manager must not rename this'
 WHERE id = 'd0000000-0000-0000-0000-000000000004';

RESET ROLE;
SELECT is(
  (SELECT name FROM public.projects WHERE id = 'd0000000-0000-0000-0000-000000000004'),
  'Phase 2 RBAC Project',
  'manager cannot change owner-only project settings'
);

SET LOCAL ROLE authenticated;
SELECT set_config('request.jwt.claim.sub', 'c0000000-0000-0000-0000-000000000003', true);
SELECT set_config('request.jwt.claims', '{"sub":"c0000000-0000-0000-0000-000000000003","role":"authenticated"}', true);

SELECT ok(
  NOT public.has_project_role(
    'd0000000-0000-0000-0000-000000000004',
    ARRAY['owner', 'manager']
  ),
  'staff does not match catalog-management roles'
);

SELECT throws_ok(
  $$INSERT INTO public.products (project_id, name, price)
    VALUES ('d0000000-0000-0000-0000-000000000004', 'Forbidden product', 1.000)$$,
  '42501',
  'new row violates row-level security policy for table "products"',
  'staff cannot create products'
);

RESET ROLE;
INSERT INTO public.orders (
  id, project_id, type, status, total_amount, order_number
) VALUES (
  'e0000000-0000-0000-0000-000000000005',
  'd0000000-0000-0000-0000-000000000004',
  'walkin',
  'pending',
  0.000,
  1
);

SET LOCAL ROLE authenticated;
SELECT set_config('request.jwt.claim.sub', 'c0000000-0000-0000-0000-000000000003', true);
SELECT set_config('request.jwt.claims', '{"sub":"c0000000-0000-0000-0000-000000000003","role":"authenticated"}', true);

SELECT lives_ok(
  $$SELECT public.advance_order_status(
    'e0000000-0000-0000-0000-000000000005', 'pending', 'preparing'
  )$$,
  'staff can perform a valid operational transition'
);

SELECT throws_ok(
  $$SELECT public.advance_order_status(
    'e0000000-0000-0000-0000-000000000005', 'preparing', 'pending'
  )$$,
  '22023',
  'INVALID_TRANSITION: preparing -> pending',
  'backward order transition is rejected'
);

RESET ROLE;
SELECT is(
  (SELECT status::text FROM public.orders WHERE id = 'e0000000-0000-0000-0000-000000000005'),
  'preparing',
  'invalid transition leaves order unchanged'
);

SELECT is(
  (SELECT count(*)::integer
     FROM public.order_audit_logs
    WHERE order_id = 'e0000000-0000-0000-0000-000000000005'
      AND event = 'status_changed'
      AND old_status = 'pending'
      AND new_status = 'preparing'),
  1,
  'valid transition writes one audit row atomically'
);

SET LOCAL ROLE service_role;
SELECT is(
  (public.rate_limit_check('phase2-atomic-test', 2, 60000)->>'allowed')::boolean,
  true,
  'first request is allowed'
);
SELECT is(
  (public.rate_limit_check('phase2-atomic-test', 2, 60000)->>'allowed')::boolean,
  true,
  'request at the limit is allowed'
);
SELECT is(
  (public.rate_limit_check('phase2-atomic-test', 2, 60000)->>'allowed')::boolean,
  false,
  'request above the limit is rejected'
);

RESET ROLE;
SELECT * FROM finish();
ROLLBACK;
