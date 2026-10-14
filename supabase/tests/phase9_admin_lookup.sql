-- phase9_admin_lookup.sql — architecture review 2026-10-13, finding P2
--
-- Runs on a FRESH database (CI: `supabase db reset` then `supabase test db`).
--
-- What is being protected: `/api/super-admin/create-project` used to resolve the
-- owner by pulling up to 1000 users from the Auth admin API and filtering in
-- JavaScript. It now calls this function, and the function's whole reason to
-- exist is the privilege boundary: the super-admin panel may look an email up,
-- a MERCHANT may not — otherwise `authenticated` could enumerate every other
-- merchant's address, which is a privacy leak the RLS on the public tables was
-- never meant to cover.

BEGIN;

CREATE EXTENSION IF NOT EXISTS pgtap WITH SCHEMA extensions;

SELECT plan(8);

-- Two accounts: one ordinary, one soft-deleted, plus an email with different case
-- to pin the case-insensitivity of the lookup.
INSERT INTO auth.users (
  instance_id, id, aud, role, email, encrypted_password,
  email_confirmed_at, raw_app_meta_data, raw_user_meta_data, created_at, updated_at
) VALUES
  ('00000000-0000-0000-0000-000000000000', 'a9000000-0000-0000-0000-000000000001', 'authenticated', 'authenticated', 'owner9@example.test', '', now(), '{"provider":"email","providers":["email"]}', '{}', now(), now()),
  ('00000000-0000-0000-0000-000000000000', 'b9000000-0000-0000-0000-000000000002', 'authenticated', 'authenticated', 'gone9@example.test', '', now(), '{"provider":"email","providers":["email"]}', '{}', now(), now());

UPDATE auth.users SET deleted_at = now() WHERE id = 'b9000000-0000-0000-0000-000000000002';

-- 1-2: the function and its exact signature.
SELECT has_function('public', 'find_user_id_by_email', ARRAY['text'], 'the email lookup exists');

SELECT ok(
  (SELECT p.prosecdef AND p.proconfig @> ARRAY['search_path=public']
     FROM pg_proc p JOIN pg_namespace n ON n.oid = p.pronamespace
    WHERE n.nspname = 'public' AND p.proname = 'find_user_id_by_email'),
  'it is SECURITY DEFINER with a pinned search_path (it reads auth.users)'
);

-- 3-5: the privilege boundary — this is the whole point of the function.
SELECT ok(
  has_function_privilege('service_role', 'public.find_user_id_by_email(text)', 'EXECUTE'),
  'service_role may resolve an email (the super-admin panel needs it)'
);

SELECT ok(
  NOT has_function_privilege('authenticated', 'public.find_user_id_by_email(text)', 'EXECUTE'),
  'a signed-in merchant may NOT: that would enumerate other merchants'' emails'
);

SELECT ok(
  NOT has_function_privilege('anon', 'public.find_user_id_by_email(text)', 'EXECUTE'),
  'anon may not either'
);

-- 6-8: behaviour.
SELECT is(
  public.find_user_id_by_email('owner9@example.test'),
  'a9000000-0000-0000-0000-000000000001'::uuid,
  'it resolves an exact email'
);

SELECT is(
  public.find_user_id_by_email('  OWNER9@Example.Test  '),
  'a9000000-0000-0000-0000-000000000001'::uuid,
  'the lookup is case-insensitive and trims (the route lowercases the input)'
);

SELECT is(
  public.find_user_id_by_email('gone9@example.test'),
  NULL,
  'a soft-deleted account resolves to NULL — it cannot sign in, so it must not be handed a project'
);

SELECT * FROM finish();
ROLLBACK;
