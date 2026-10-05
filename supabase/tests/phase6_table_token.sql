-- phase6_table_token.sql — audit 2026-10-05 (Task 2, finding #1)
--
-- Runs on a FRESH database (CI: `supabase db reset` then `supabase test db`), so these
-- assertions describe the schema the migrations create, not production's data.
--
-- What is being protected: the public order path must prove WHICH table it orders for
-- using the 128-bit scan token, and that token must remain unreadable by anon — the
-- property 0000_init.sql:2135 establishes with a column-level REVOKE.

BEGIN;

CREATE EXTENSION IF NOT EXISTS pgtap WITH SCHEMA extensions;

SELECT plan(6);

-- 1. The resolver exists with the exact signature the route and the menu page call.
SELECT has_function(
  'public',
  'resolve_table_by_token',
  ARRAY['text', 'text'],
  'table scan-token resolver exists'
);

-- 2. …and the public menu (anon) can call it. Without this the menu page would have to
--    read tables.qrcode, which is exactly what must never happen.
SELECT ok(
  has_function_privilege('anon', 'public.resolve_table_by_token(text,text)', 'EXECUTE'),
  'anon can resolve a table by token'
);

-- 3. The token itself stays invisible to anon — the whole point of the REVOKE.
SELECT ok(
  NOT has_column_privilege('anon', 'public.tables', 'qrcode', 'SELECT'),
  'anon still cannot read tables.qrcode'
);

-- 4. Uniqueness is what makes attribution sound.
SELECT ok(
  EXISTS (
    SELECT 1 FROM pg_indexes
     WHERE schemaname = 'public' AND indexname = 'tables_qrcode_key'
  ),
  'tables.qrcode is uniquely indexed'
);

-- 5. A token that matches nothing resolves to nothing (no accidental "first table" fallback).
SELECT is(
  (SELECT public.resolve_table_by_token('no-such-slug-at-all', repeat('a', 32))),
  NULL,
  'unknown slug + token resolves to null'
);

-- 6. The resolver is SECURITY DEFINER with a pinned search_path — a mutable search_path
--    on a function that anon can execute is a privilege-escalation primitive.
SELECT ok(
  (SELECT p.prosecdef AND p.proconfig @> ARRAY['search_path=public']
     FROM pg_proc p
     JOIN pg_namespace n ON n.oid = p.pronamespace
    WHERE n.nspname = 'public' AND p.proname = 'resolve_table_by_token'),
  'resolver is SECURITY DEFINER with a pinned search_path'
);

SELECT * FROM finish();
ROLLBACK;
