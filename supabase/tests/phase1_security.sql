BEGIN;

CREATE EXTENSION IF NOT EXISTS pgtap WITH SCHEMA extensions;

SELECT plan(8);

SELECT ok(
  NOT has_table_privilege('anon', 'public.projects', 'DELETE'),
  'anon cannot delete projects'
);

SELECT ok(
  NOT has_table_privilege('authenticated', 'public.projects', 'DELETE'),
  'authenticated users cannot delete projects'
);

SELECT is(
  (SELECT count(*)::integer
     FROM pg_policies
    WHERE schemaname = 'public'
      AND tablename = 'projects'
      AND policyname = 'projects_delete_owner'),
  0,
  'owner project delete policy is absent'
);

SELECT ok(
  NOT has_function_privilege(
    'anon',
    'public.onboard_project_transactional(text,text,text,text,uuid)',
    'EXECUTE'
  ),
  'anonymous callers cannot execute onboarding RPC'
);

SELECT ok(
  NOT has_function_privilege(
    'authenticated',
    'public.onboard_project_transactional(text,text,text,text,uuid)',
    'EXECUTE'
  ),
  'authenticated callers cannot execute onboarding RPC'
);

SELECT is(
  (SELECT confdeltype::text
     FROM pg_constraint
    WHERE conname = 'subscription_payments_project_id_fkey'),
  'n',
  'deleting a project nulls the payment reference'
);

SELECT has_function(
  'public',
  'super_admin_hard_delete_project',
  ARRAY['uuid', 'text', 'text', 'uuid'],
  'guarded hard-delete RPC exists'
);

SELECT ok(
  EXISTS (
    SELECT 1
      FROM pg_constraint
     WHERE conname = 'impersonation_target_session_no_refresh'
  ),
  'database forbids storing target refresh tokens'
);

SELECT * FROM finish();
ROLLBACK;
