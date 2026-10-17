-- phase11 — the signup boundary (backend audit B-1, 2026-10-16)
--
-- What this asserts, in the order the finding was proved: the app's own provisioning path still
-- works, and a direct signup — the one an anonymous caller can reach with the public anon key —
-- is refused BY THE DATABASE, not by a Next route.
--
-- The probe rows use a throwaway instance_id and distinct emails, and the whole file runs inside a
-- transaction that ends with ROLLBACK: nothing is left in auth.users.
--
-- Run against a scratch database (`supabase test db`, which is what CI does) or as
-- `psql "$DATABASE_URL" -f …` — the latter writes nothing either, because of the ROLLBACK.

BEGIN;

CREATE EXTENSION IF NOT EXISTS pgtap WITH SCHEMA extensions;
SELECT plan(4);

-- ---------------------------------------------------------------- 1. the guard is installed
SELECT ok(
  EXISTS (
    SELECT 1
      FROM pg_trigger t
      JOIN pg_class c ON c.oid = t.tgrelid
      JOIN pg_namespace n ON n.oid = c.relnamespace
     WHERE n.nspname = 'auth' AND c.relname = 'users'
       AND t.tgname = 'auth_users_require_api_provisioning'
       AND NOT t.tgisinternal
  ),
  'auth.users carries the provisioning guard'
);

-- ---------------------------------------------------------------- 2. not callable from the web
SELECT ok(
  NOT has_function_privilege('anon', 'public.auth_users_require_api_provisioning()', 'EXECUTE')
  AND NOT has_function_privilege('authenticated', 'public.auth_users_require_api_provisioning()', 'EXECUTE'),
  'the trigger function is not executable by anon or authenticated'
);

-- ---------------------------------------------------------------- 3. a direct signup is refused
-- This is the exact shape a caller of GoTrue's own /auth/v1/signup produces: a row with no
-- app_metadata marker (GoTrue maps client input to raw_user_meta_data, never to raw_app_meta_data).
SELECT throws_ok(
  $$ INSERT INTO auth.users (id, instance_id, aud, role, email, raw_app_meta_data)
     VALUES (gen_random_uuid(), '00000000-0000-0000-0000-000000000000',
             'authenticated', 'authenticated', 'phase11-nomarker@example.test', '{}'::jsonb) $$,
  '42501',
  NULL,
  'a signup without the provisioning marker is refused'
);

-- ---------------------------------------------------------------- 4. the app's path still works
SELECT lives_ok(
  $$ INSERT INTO auth.users (id, instance_id, aud, role, email, raw_app_meta_data)
     VALUES (gen_random_uuid(), '00000000-0000-0000-0000-000000000000',
             'authenticated', 'authenticated', 'phase11-marked@example.test',
             '{"provisioned_by":"dokan-admin-api"}'::jsonb) $$,
  'an account provisioned by the app API is accepted'
);

SELECT * FROM finish();
ROLLBACK;
