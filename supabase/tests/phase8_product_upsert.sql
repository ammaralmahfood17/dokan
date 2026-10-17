-- phase8_product_upsert.sql — architecture review 2026-10-13, finding P0
--
-- Runs on a FRESH database (CI: `supabase db reset` then `supabase test db`), so these
-- assertions describe what the migrations create, not production's data.
--
-- What is being protected: the product editor used to save the product and its option
-- tree with up to ten un-transacted statements from the browser, so a mid-flight failure
-- left a product with no options (or options attached to nothing). Since
-- 20261013120000_upsert_product_with_options.sql the whole save is ONE call, and the
-- assertions below are the contract: it is atomic, it is tenant-scoped, it replaces the
-- tree wholesale, and it stays callable by exactly the roles that already own those rows.
--
-- The RLS surface is exercised by running the calls AS `authenticated` (SET LOCAL ROLE),
-- so a policy regression fails here rather than in the field.

BEGIN;

CREATE EXTENSION IF NOT EXISTS pgtap WITH SCHEMA extensions;

SELECT plan(21);

INSERT INTO auth.users (
  instance_id, id, aud, role, email, encrypted_password,
  email_confirmed_at, raw_app_meta_data, raw_user_meta_data, created_at, updated_at
) VALUES
  ('00000000-0000-0000-0000-000000000000', 'a8000000-0000-0000-0000-000000000001', 'authenticated', 'authenticated', 'p8-owner@example.test', '', now(), '{"provider":"email","providers":["email"],"provisioned_by":"dokan-admin-api"}', '{}', now(), now()),
  ('00000000-0000-0000-0000-000000000000', 'b8000000-0000-0000-0000-000000000002', 'authenticated', 'authenticated', 'p8-manager@example.test', '', now(), '{"provider":"email","providers":["email"],"provisioned_by":"dokan-admin-api"}', '{}', now(), now()),
  ('00000000-0000-0000-0000-000000000000', 'c8000000-0000-0000-0000-000000000003', 'authenticated', 'authenticated', 'p8-staff@example.test', '', now(), '{"provider":"email","providers":["email"],"provisioned_by":"dokan-admin-api"}', '{}', now(), now());

INSERT INTO public.projects (id, name, slug, currency, primary_color, is_active, created_by) VALUES
  ('d8000000-0000-0000-0000-000000000004', 'Phase 8 Project', 'phase-8-product-upsert', 'BHD', '#4338CA', true, 'a8000000-0000-0000-0000-000000000001'),
  ('d8000000-0000-0000-0000-000000000005', 'Phase 8 Other', 'phase-8-product-other', 'BHD', '#4338CA', true, 'a8000000-0000-0000-0000-000000000001');

INSERT INTO public.staff_members (project_id, user_id, role) VALUES
  ('d8000000-0000-0000-0000-000000000004', 'a8000000-0000-0000-0000-000000000001', 'owner'),
  ('d8000000-0000-0000-0000-000000000004', 'b8000000-0000-0000-0000-000000000002', 'manager'),
  ('d8000000-0000-0000-0000-000000000004', 'c8000000-0000-0000-0000-000000000003', 'staff');

INSERT INTO public.categories (id, project_id, name) VALUES
  ('e8000000-0000-0000-0000-000000000006', 'd8000000-0000-0000-0000-000000000004', 'مشروبات'),
  ('e8000000-0000-0000-0000-000000000007', 'd8000000-0000-0000-0000-000000000005', 'Private Category');

-- The product that lives in the OTHER tenant, for the cross-tenant update attempt.
INSERT INTO public.products (id, project_id, name, price) VALUES
  ('f8000000-0000-0000-0000-000000000008', 'd8000000-0000-0000-0000-000000000005', 'Foreign Product', 9.000);

-- Results land in temp tables so an assertion can read what the RPC returned.
CREATE TEMP TABLE p8_result (label text, value jsonb) ON COMMIT DROP;
CREATE TEMP TABLE p8_id (value uuid) ON COMMIT DROP;
GRANT SELECT, INSERT ON p8_result, p8_id TO authenticated, service_role;

-- ── 1-4: the function's shape, and who may call it ──────────────────────────
SELECT has_function(
  'public', 'upsert_product_with_options',
  ARRAY['uuid', 'uuid', 'text', 'text', 'text', 'numeric', 'uuid', 'boolean', 'text', 'integer', 'jsonb'],
  'the product upsert accepts the product fields + the option tree'
);

SELECT ok(
  NOT has_function_privilege('anon', 'public.upsert_product_with_options(uuid,uuid,text,text,text,numeric,uuid,boolean,text,integer,jsonb)', 'EXECUTE'),
  'anon cannot call the product upsert (it has no write policy on products or options)'
);

SELECT ok(
  has_function_privilege('authenticated', 'public.upsert_product_with_options(uuid,uuid,text,text,text,numeric,uuid,boolean,text,integer,jsonb)', 'EXECUTE'),
  'authenticated can call it — RLS, not the grant, is what narrows it to owner/manager'
);

SELECT ok(
  (SELECT NOT p.prosecdef AND p.proconfig @> ARRAY['search_path=public']
     FROM pg_proc p JOIN pg_namespace n ON n.oid = p.pronamespace
    WHERE n.nspname = 'public' AND p.proname = 'upsert_product_with_options'),
  'it is SECURITY INVOKER with a pinned search_path (RLS stays the boundary)'
);

-- ── 5: plain staff may not write products ───────────────────────────────────
SET LOCAL ROLE authenticated;
SELECT set_config('request.jwt.claim.sub', 'c8000000-0000-0000-0000-000000000003', true);
SELECT set_config('request.jwt.claim.role', 'authenticated', true);
SELECT set_config('request.jwt.claims', '{"sub":"c8000000-0000-0000-0000-000000000003","role":"authenticated"}', true);

SELECT throws_ok(
  $$SELECT public.upsert_product_with_options(
      'd8000000-0000-0000-0000-000000000004', null, 'قهوة', null, null, 1.000,
      null, true, null, null, '[]'::jsonb)$$,
  '42501', 'NOT_AUTHORIZED',
  'staff cannot create a product through the upsert'
);
RESET ROLE;

-- ── 6-11: the owner's happy path, then the update path ──────────────────────
SET LOCAL ROLE authenticated;
SELECT set_config('request.jwt.claim.sub', 'a8000000-0000-0000-0000-000000000001', true);
SELECT set_config('request.jwt.claim.role', 'authenticated', true);
SELECT set_config('request.jwt.claims', '{"sub":"a8000000-0000-0000-0000-000000000001","role":"authenticated"}', true);

INSERT INTO p8_result (label, value)
SELECT 'created', public.upsert_product_with_options(
  'd8000000-0000-0000-0000-000000000004',
  null,
  'قهوة عربية',
  'Arabic Coffee',
  'بالهيل',
  1.250,
  'e8000000-0000-0000-0000-000000000006',
  true,
  null,
  null,
  '[{"name":"الحجم","min_select":0,"max_select":1,"choices":[{"name":"صغير","price":0},{"name":"كبير","price":0.500}]},
    {"name":"الإضافات","min_select":0,"max_select":99,"choices":[{"name":"هيل","price":0.100}]}]'::jsonb
);

SELECT is(
  (SELECT jsonb_array_length(value -> 'option_groups') FROM p8_result WHERE label = 'created'),
  2,
  'the created product comes back with both option groups'
);

SELECT is(
  (SELECT value -> 'option_groups' -> 1 -> 'option_choices' -> 0 ->> 'price' FROM p8_result WHERE label = 'created'),
  '0.100',
  'a variety keeps its own price'
);

INSERT INTO p8_id (value) SELECT (value ->> 'id')::uuid FROM p8_result WHERE label = 'created';

SELECT is(
  (SELECT stock FROM public.products WHERE id = (SELECT value FROM p8_id)),
  NULL,
  'an empty stock field is stored as untracked (NULL), not 0'
);

SELECT is(
  (SELECT sort_order FROM public.products WHERE id = (SELECT value FROM p8_id)),
  0,
  'the first product of a project is appended at sort_order 0'
);

INSERT INTO p8_result (label, value)
SELECT 'updated', public.upsert_product_with_options(
  'd8000000-0000-0000-0000-000000000004',
  (SELECT value FROM p8_id),
  'قهوة عربية',
  null,
  null,
  1.500,
  null,
  true,
  null,
  7,
  '[{"name":"الحجم","min_select":1,"max_select":1,"choices":[{"name":"وسط","price":0.250}]}]'::jsonb
);

SELECT is(
  (SELECT count(*)::integer FROM public.option_groups WHERE product_id = (SELECT value FROM p8_id)),
  1,
  'updating replaces the option tree wholesale (the old groups are gone)'
);

SELECT is(
  (SELECT price FROM public.products WHERE id = (SELECT value FROM p8_id)),
  1.500::numeric,
  'updating changes the product row itself'
);

SELECT is(
  (SELECT stock FROM public.products WHERE id = (SELECT value FROM p8_id)),
  7,
  'a tracked stock count is stored as given'
);

SELECT is(
  (SELECT count(*)::integer FROM public.option_choices c
     JOIN public.option_groups g ON g.id = c.group_id
    WHERE g.product_id = (SELECT value FROM p8_id)),
  1,
  'and the varieties of the removed groups go with them (cascade)'
);

-- ── 12-15: tenant and input guards ─────────────────────────────────────────
SELECT throws_ok(
  $$SELECT public.upsert_product_with_options(
      'd8000000-0000-0000-0000-000000000004', 'f8000000-0000-0000-0000-000000000008',
      'تسلل', null, null, 1.000, null, true, null, null, '[]'::jsonb)$$,
  'P0001', 'PRODUCT_NOT_FOUND',
  'an owner cannot update a product that belongs to another project'
);

SELECT throws_ok(
  $$SELECT public.upsert_product_with_options(
      'd8000000-0000-0000-0000-000000000004', null, 'قهوة', null, null, 1.000,
      'e8000000-0000-0000-0000-000000000007', true, null, null, '[]'::jsonb)$$,
  'P0001', 'CATEGORY_NOT_FOUND',
  'a category from another project is refused'
);

SELECT throws_ok(
  $$SELECT public.upsert_product_with_options(
      'd8000000-0000-0000-0000-000000000004', null, 'قهوة', null, null, 1.000,
      null, true, null, null,
      '[{"name":"الحجم","min_select":0,"max_select":1,"choices":[]}]'::jsonb)$$,
  'P0001', 'GROUP_NEEDS_CHOICE',
  'a group with no varieties is refused (it would render as nothing)'
);

SELECT throws_ok(
  $$SELECT public.upsert_product_with_options(
      'd8000000-0000-0000-0000-000000000004', null, 'قهوة', null, null, -1.000,
      null, true, null, null, '[]'::jsonb)$$,
  'P0001', 'INVALID_PRICE',
  'a negative price is refused'
);

RESET ROLE;

-- ── 18: an unauthenticated caller gets nothing ─────────────────────────────
-- Both the modern `request.jwt.claims` JSON and the legacy scalar claims have to
-- be cleared: auth.uid() falls back to the scalar, so leaving it set would let
-- this assert the wrong thing (it did, on the first run of this file).
SET LOCAL ROLE authenticated;
SELECT set_config('request.jwt.claims', '{}', true);
SELECT set_config('request.jwt.claim.sub', '', true);
SELECT set_config('request.jwt.claim.role', '', true);
SELECT throws_ok(
  $$SELECT public.upsert_product_with_options(
      'd8000000-0000-0000-0000-000000000004', null, 'قهوة', null, null, 1.000,
      null, true, null, null, '[]'::jsonb)$$,
  '42501', 'NOT_AUTHORIZED',
  'a session with no auth.uid() is refused (a service-role call cannot smuggle itself in)'
);
RESET ROLE;

-- ── 17-19: a second product lands after the first, and stays a separate row ──
SET LOCAL ROLE authenticated;
SELECT set_config('request.jwt.claims', '{"sub":"a8000000-0000-0000-0000-000000000001","role":"authenticated"}', true);

INSERT INTO p8_result (label, value)
SELECT 'second', public.upsert_product_with_options(
  'd8000000-0000-0000-0000-000000000004', null, 'شاي', null, null, 0.800,
  null, true, null, null, '[]'::jsonb
);

SELECT is(
  (SELECT sort_order FROM public.products WHERE id = ((SELECT value FROM p8_result WHERE label = 'second') ->> 'id')::uuid),
  1,
  'the next product is appended after the existing one'
);

SELECT is(
  (SELECT jsonb_array_length((SELECT value -> 'option_groups' FROM p8_result WHERE label = 'second'))),
  0,
  'a product with no options returns an empty (not NULL) option_groups array'
);

SELECT is(
  (SELECT count(*)::integer FROM public.products WHERE project_id = 'd8000000-0000-0000-0000-000000000004'),
  2,
  'neither call touched another tenant''s product'
);

RESET ROLE;

SELECT * FROM finish();
ROLLBACK;
