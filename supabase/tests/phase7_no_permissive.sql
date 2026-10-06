-- phase7_no_permissive.sql — audit 2026-10-05 (Task 2, findings #5, #4 and #14).
--
-- Runs on a FRESH database (CI: `supabase db reset` then `supabase test db`), so these
-- assertions describe the schema the migrations create, not production's data.
--
-- Purpose: turn the audit's one-time inspection into a permanent gate. Each assertion is a
-- CLASS of defect rather than a specific object, so the next occurrence fails CI instead of
-- waiting for another audit.

BEGIN;

CREATE EXTENSION IF NOT EXISTS pgtap WITH SCHEMA extensions;

SELECT plan(6);

-- 1. No permissive policy anywhere in public. `USING (true)` on a tenant table is the whole
--    cross-tenant leak in one line.
SELECT is(
  (
    SELECT count(*)::integer
      FROM pg_policies
     WHERE schemaname = 'public'
       AND (qual = 'true' OR with_check = 'true')
  ),
  0,
  'no USING (true) / WITH CHECK (true) policy exists in public'
);

-- 2. Every public table still has RLS enabled. A table that loses it becomes world-readable
--    to the anon key without any policy change being visible.
SELECT is(
  (
    SELECT count(*)::integer
      FROM pg_tables t
      JOIN pg_class c ON c.relname = t.tablename
      JOIN pg_namespace n ON n.oid = c.relnamespace AND n.nspname = t.schemaname
     WHERE t.schemaname = 'public' AND NOT c.relrowsecurity
  ),
  0,
  'every public table has RLS enabled'
);

-- 3. Regression guard for the privilege model 0013 established: the web roles write orders
--    only through the SECURITY DEFINER RPCs, never directly.
SELECT ok(
  NOT has_table_privilege('authenticated', 'public.orders', 'INSERT')
  AND NOT has_table_privilege('authenticated', 'public.orders', 'UPDATE')
  AND NOT has_table_privilege('anon', 'public.orders', 'SELECT'),
  'orders is server-written only (no direct INSERT/UPDATE for authenticated, no SELECT for anon)'
);

-- 4. Every SECURITY DEFINER function pins its search_path. Without it, a caller-controlled
--    schema on the search path can hijack the function's object resolution.
SELECT is(
  (
    SELECT count(*)::integer
      FROM pg_proc p
      JOIN pg_namespace n ON n.oid = p.pronamespace
     WHERE n.nspname = 'public' AND p.prosecdef AND p.proconfig IS NULL
  ),
  0,
  'every SECURITY DEFINER function pins search_path'
);

-- 5. Replaces the RETRACTED W2-T1 index finding (audit T2 #4): ASSERT COMPLETENESS instead of
--    two hard-coded index names, so the next unindexed foreign key fails CI.
--    (The finding was wrong — the indexes existed since 0006:81-82; a truncated `grep | head`
--    was reported as a database fact. This assertion is the stronger replacement.)
SELECT is(
  (
    SELECT count(*)::integer
      FROM pg_constraint c
      JOIN unnest(c.conkey) AS k(attnum) ON true
     WHERE c.contype = 'f'
       AND c.connamespace = 'public'::regnamespace
       AND NOT EXISTS (
         SELECT 1 FROM pg_index i
          WHERE i.indrelid = c.conrelid AND i.indkey[0] = k.attnum
       )
  ),
  0,
  'every foreign key in public has a covering index'
);

-- W6-T2 (audit T2 #14): no FUTURE table or sequence in `public` may be handed to a web role.
--
-- This assertion is the permanent guard for the drift described in
-- 20261006150000_default_acl_hardening.sql: the platform bootstrap granted these defaults and nothing
-- in the repository revoked them, so a FRESH database (`supabase db reset`, this CI job) auto-exposed
-- every new table while production - cleaned outside the repository - measured 0. This test is what
-- makes the two agree from now on.
--
-- Scoped to `public` and to objects owned by `postgres`: the platform-owned defaults live in
-- `storage` / `graphql` / `graphql_public` and cannot be changed by the migration runner anyway
-- ("permission denied to change default privileges", verified). Functions are excluded because
-- `anon` needs EXECUTE on the SECURITY DEFINER resolvers the public menu calls.
SELECT is(
  (SELECT count(*)::integer
     FROM pg_default_acl d
     JOIN pg_roles r ON r.oid = d.defaclrole
     JOIN pg_namespace n ON n.oid = d.defaclnamespace,
     LATERAL aclexplode(d.defaclacl) a
    WHERE r.rolname = 'postgres'
      AND n.nspname = 'public'
      AND d.defaclobjtype IN ('r', 'S')
      AND a.grantee IN ('anon'::regrole, 'authenticated'::regrole)),
  0,
  'no default privilege grants future tables/sequences in public to anon or authenticated'
);

SELECT * FROM finish();

ROLLBACK;
