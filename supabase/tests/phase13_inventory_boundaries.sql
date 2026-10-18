BEGIN;

-- F-18 follow-up / audit gap closure (2026-10-18):
--   • the two inventory RPCs whose FUNCTION grants were never pinned in pgTAP
--     (`adjust_ingredient_stock`, `replace_product_recipe`). phase12 pins
--     `create_order_transactional` and `advance_order_status`; these two were the blind spot that
--     let a "anon can execute" false positive look plausible.
--   • cross-tenant rejection on `create_order_transactional`, in BOTH shapes:
--       (a) a caller who is a member of tenant A naming tenant B as the project, and
--       (b) tenant A's project with a product id belonging to tenant B.
--     Neither was asserted anywhere; the membership check and the PRODUCT_NOT_FOUND branch were
--     only read, never executed by a test.
--
-- Still OPEN (documented, not silently skipped): a true two-session race (two orders racing on the
-- last unit of stock, and two racing with the same idempotency key). It needs a second connection
-- (dblink) and is written up in docs/audit-2026-10/REMEDIATION.md rather than faked here.

CREATE EXTENSION IF NOT EXISTS pgtap WITH SCHEMA extensions;
SELECT plan(6);

-- ── 1. Function grants ────────────────────────────────────────────────────────────────────────────
SELECT ok(
  NOT has_function_privilege('anon', 'public.adjust_ingredient_stock(uuid,text,numeric,text)', 'EXECUTE'),
  'anon cannot adjust ingredient stock'
);
SELECT ok(
  NOT has_function_privilege('anon', 'public.replace_product_recipe(uuid,jsonb)', 'EXECUTE'),
  'anon cannot rewrite a product recipe'
);
SELECT ok(
  has_function_privilege('authenticated', 'public.adjust_ingredient_stock(uuid,text,numeric,text)', 'EXECUTE'),
  'authenticated may call the stock RPC (the role gate inside is what refuses staff)'
);
SELECT ok(
  has_function_privilege('authenticated', 'public.replace_product_recipe(uuid,jsonb)', 'EXECUTE'),
  'authenticated may call the recipe RPC (the role gate inside is what refuses staff)'
);

-- ── 2. Cross-tenant rejection ─────────────────────────────────────────────────────────────────────
INSERT INTO auth.users (
  instance_id, id, aud, role, email, encrypted_password,
  email_confirmed_at, raw_app_meta_data, raw_user_meta_data, created_at, updated_at
) VALUES (
  '00000000-0000-0000-0000-000000000000',
  'a9000000-0000-0000-0000-000000000001',
  'authenticated', 'authenticated', 'boundary-owner@example.test', '', now(),
  '{"provider":"email","providers":["email"],"provisioned_by":"dokan-admin-api"}', '{}', now(), now()
);

INSERT INTO public.projects (id, name, slug, currency, primary_color, is_active, created_by) VALUES
  ('d9000000-0000-0000-0000-000000000001', 'Boundary A', 'boundary-a', 'BHD', '#4338CA', true, 'a9000000-0000-0000-0000-000000000001'),
  ('d9000000-0000-0000-0000-000000000002', 'Boundary B', 'boundary-b', 'BHD', '#4338CA', true, 'a9000000-0000-0000-0000-000000000001');

INSERT INTO public.staff_members (project_id, user_id, role)
VALUES ('d9000000-0000-0000-0000-000000000001', 'a9000000-0000-0000-0000-000000000001', 'owner');

INSERT INTO public.products (id, project_id, name, price, stock, is_available) VALUES
  ('e9000000-0000-0000-0000-000000000001', 'd9000000-0000-0000-0000-000000000001', 'Tenant A Meal', 1.000, NULL, true),
  ('e9000000-0000-0000-0000-000000000002', 'd9000000-0000-0000-0000-000000000002', 'Tenant B Meal', 1.000, NULL, true);

SET LOCAL ROLE service_role;
SELECT set_config('request.jwt.claim.sub', 'a9000000-0000-0000-0000-000000000001', true);
SELECT set_config('request.jwt.claim.role', 'service_role', true);
SELECT set_config('request.jwt.claims', '{"sub":"a9000000-0000-0000-0000-000000000001","role":"service_role"}', true);

-- (a) the caller is a member of A only, but names B as the project
SELECT throws_ok(
  $$SELECT public.create_order_transactional(
      'd9000000-0000-0000-0000-000000000002',
      'walkin', 'pending', 0, 0,
      '[{"product_id":"e9000000-0000-0000-0000-000000000002","quantity":1,"addons":[]}]'::jsonb,
      NULL, NULL, 'a9000000-0000-0000-0000-000000000001',
      NULL
    )$$,
  '42501',
  'not authorized for this project',
  'a member of tenant A cannot create an order for tenant B'
);

-- (b) project A, but the cart references tenant B's product
SELECT throws_ok(
  $$SELECT public.create_order_transactional(
      'd9000000-0000-0000-0000-000000000001',
      'walkin', 'pending', 0, 0,
      '[{"product_id":"e9000000-0000-0000-0000-000000000002","quantity":1,"addons":[]}]'::jsonb,
      NULL, NULL, 'a9000000-0000-0000-0000-000000000001',
      NULL
    )$$,
  'P0001',
  'PRODUCT_NOT_FOUND',
  'a cart line from another tenant is rejected, not repriced'
);

RESET ROLE;

SELECT * FROM finish();
ROLLBACK;
