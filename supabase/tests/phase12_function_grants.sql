-- phase12 — the FUNCTION-level boundary (backend audit, 2026-10-16)
--
-- Why this file exists: the report's own gap list, and the lesson of a false CRITICAL that a
-- subagent filed in October, both came from the same blind spot — the tests asserted TABLE and
-- COLUMN grants, and nothing asserted `has_function_privilege`. `0000_init.sql` grants EXECUTE to
-- `anon` on functions BY DEFAULT and a later `CREATE OR REPLACE` preserves the ACL it inherits, so
-- "the grant looks implicit" is exactly what a reader gets wrong. Measured here, not inferred.
--
-- Runs against a fresh database (what CI does) and against production (each statement is a read;
-- the file opens no transaction that writes and leaves nothing behind).

BEGIN;

CREATE EXTENSION IF NOT EXISTS pgtap WITH SCHEMA extensions;
SELECT plan(8);

-- ------------------------------------------------ 1-3. the money RPCs: service_role only
SELECT ok(
  NOT has_function_privilege(
    'anon',
    'public.create_order_transactional(uuid,text,text,numeric,integer,jsonb,uuid,text,uuid,uuid)',
    'EXECUTE'
  ),
  'anon cannot execute the order RPC'
);

SELECT ok(
  NOT has_function_privilege(
    'authenticated',
    'public.create_order_transactional(uuid,text,text,numeric,integer,jsonb,uuid,text,uuid,uuid)',
    'EXECUTE'
  ),
  'authenticated cannot execute the order RPC (the boundary is the absent grant, not a policy)'
);

SELECT ok(
  has_function_privilege(
    'service_role',
    'public.create_order_transactional(uuid,text,text,numeric,integer,jsonb,uuid,text,uuid,uuid)',
    'EXECUTE'
  ),
  'service_role CAN execute the order RPC — the positive half, so a lockdown cannot break the product'
);

-- ------------------------------------------------ 4. the payment RPC, same shape
SELECT ok(
  NOT has_function_privilege(
    'anon',
    'public.record_payment_and_renew(uuid,numeric,text,text,text,integer,uuid,uuid)',
    'EXECUTE'
  )
  AND NOT has_function_privilege(
    'authenticated',
    'public.record_payment_and_renew(uuid,numeric,text,text,text,integer,uuid,uuid)',
    'EXECUTE'
  )
  AND has_function_privilege(
    'service_role',
    'public.record_payment_and_renew(uuid,numeric,text,text,text,integer,uuid,uuid)',
    'EXECUTE'
  ),
  'the payment RPC is service_role-only, in both directions'
);

-- ------------------------------------------------ 5. the dashboard RPC is authenticated, by design
-- `advance_order_status` is called by the kitchen and POS dashboards with the SESSION client, so
-- `authenticated` must keep EXECUTE; the authorisation is inside the body (`has_project_role`).
-- Pinned because "a grant to authenticated" is the shape a future reader would flag as a hole.
SELECT ok(
  NOT has_function_privilege('anon', 'public.advance_order_status(uuid,text,text,uuid)', 'EXECUTE')
  AND has_function_privilege('authenticated', 'public.advance_order_status(uuid,text,text,uuid)', 'EXECUTE'),
  'status advance: anon cannot, authenticated can (membership is enforced in the body)'
);

-- ------------------------------------------------ 6. the exact anon-executable set
-- Two functions, and only two: the storefront's availability check and the table-token resolver.
-- A strict equality rather than a count, so a third one appearing fails with its name in the diff.
SELECT is(
  (SELECT coalesce(string_agg(p.proname, ',' ORDER BY p.proname), '(none)')
     FROM pg_proc p
     JOIN pg_namespace n ON n.oid = p.pronamespace
    WHERE n.nspname = 'public'
      AND p.prorettype <> 'trigger'::regtype
      AND has_function_privilege('anon', p.oid, 'EXECUTE')),
  'is_project_publicly_available,resolve_table_by_token',
  'exactly two public functions are anon-executable (the documented pair)'
);

-- ------------------------------------------------ 7. the PUBLIC default grant, named exactly
-- `REVOKE ... FROM anon, authenticated` (what 0010 and 0013 both wrote) leaves the default
-- `=X/postgres` entry — EXECUTE for PUBLIC — untouched, and the revoke then LOOKS applied while
-- `has_function_privilege('anon', …)` keeps answering true. So assert the ACL itself, not the file.
--
-- Measured on the first run of this file: exactly ONE function carries it —
-- `is_project_publicly_available(text)`, and that is deliberate (the storefront root and the
-- closed-store page must ask "is this store open?" BEFORE anyone signs in; the function reads one
-- project row and returns one boolean). Everything else must be free of it, which is what this
-- pins: a future `CREATE FUNCTION` that inherits the default fails CI, and the deliberate one
-- cannot quietly become two.
SELECT is(
  (SELECT coalesce(string_agg(p.proname, ',' ORDER BY p.proname), '(none)')
     FROM pg_proc p
     JOIN pg_namespace n ON n.oid = p.pronamespace
    WHERE n.nspname = 'public'
      AND p.proacl IS NOT NULL
      AND EXISTS (SELECT 1 FROM unnest(p.proacl) a WHERE a::text LIKE '=X/%')),
  'is_project_publicly_available',
  'only the documented pre-auth read carries the PUBLIC (=X) EXECUTE entry'
);

-- ------------------------------------------------ 8. every definer pins its search_path
SELECT is(
  (SELECT count(*)::integer
     FROM pg_proc p
     JOIN pg_namespace n ON n.oid = p.pronamespace
    WHERE n.nspname = 'public'
      AND p.prosecdef
      AND (p.proconfig IS NULL
           OR NOT EXISTS (SELECT 1 FROM unnest(p.proconfig) c WHERE c LIKE 'search_path=%'))),
  0,
  'every SECURITY DEFINER function pins its search_path'
);

SELECT * FROM finish();
ROLLBACK;
