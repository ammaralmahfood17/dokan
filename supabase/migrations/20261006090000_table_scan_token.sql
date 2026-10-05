-- 20261006090000_table_scan_token.sql
--
-- Audit 2026-10-05 (Task 2, finding #1 — CRITICAL). `tables.qrcode` has always been
-- the table's scan token: 128-bit random (0000_init.sql:656) and 0000_init.sql:2135
-- explicitly REVOKEs it from anon with the comment "qrcode (the table's scan token)
-- must not be exposed to anon". Nothing ever CHECKED it. Ordering was authorised by
-- `slug` alone — "table-1", which the public storefront page (/[projectSlug]) publishes
-- for every active table — so any anonymous caller could inject orders into any active
-- tenant's kitchen.
--
-- This migration adds the resolver the public menu needs (the qrcode column itself
-- stays invisible to anon). Enforcement lives in the route, behind REQUIRE_TABLE_TOKEN,
-- so it can be switched on only after the QR sheets are reprinted.
--
-- Verified against production before writing (2026-10-06, read-only):
--   tables_total=2, tokens_missing=0, duplicate_token_groups=0, all tokens 32-hex
--   → the UNIQUE index below cannot fail on existing data.
--
-- ROLLBACK:
--   DROP FUNCTION IF EXISTS public.resolve_table_by_token(text, text);
--   -- the index is intentionally NOT rolled back: it is harmless and useful.

CREATE OR REPLACE FUNCTION public.resolve_table_by_token(
  p_project_slug text,
  p_table_token  text
) RETURNS jsonb
LANGUAGE sql
STABLE
SECURITY DEFINER
SET search_path TO 'public'
AS $$
  SELECT jsonb_build_object('id', t.id, 'number', t.number)
    FROM public.tables t
    JOIN public.projects p ON p.id = t.project_id
   WHERE p.slug = p_project_slug
     AND p.is_active
     AND p.subscription_expires_at > now()   -- fail closed: no expiry = no ordering
     AND t.is_active
     AND t.qrcode = p_table_token
   LIMIT 1;
$$;

REVOKE ALL ON FUNCTION public.resolve_table_by_token(text, text) FROM PUBLIC;
GRANT EXECUTE ON FUNCTION public.resolve_table_by_token(text, text)
  TO anon, authenticated, service_role;

-- The public order path now looks a table up by token on every request.
-- NOTE: plain CREATE INDEX takes ACCESS EXCLUSIVE. Production `tables` holds 2 rows
-- (pg_stat_user_tables, 2026-10-06) so this is instantaneous; Supabase migrations run
-- inside a transaction, so CONCURRENTLY is not available here. If `tables` ever exceeds
-- ~100k rows, build this manually with CREATE INDEX CONCURRENTLY outside a transaction.
CREATE UNIQUE INDEX IF NOT EXISTS tables_qrcode_key ON public.tables(qrcode);

COMMENT ON FUNCTION public.resolve_table_by_token(text, text) IS
  'Public-menu resolver: (project slug, per-table scan token) -> table. 128-bit token, never exposes tables.qrcode to anon. Audit 2026-10-05.';

COMMENT ON INDEX public.tables_qrcode_key IS
  'Uniqueness is a security property: two tables sharing a scan token would break order attribution. Audit 2026-10-05.';

DO $$
BEGIN
  IF EXISTS (
    SELECT 1
      FROM pg_proc p
      JOIN pg_namespace n ON n.oid = p.pronamespace
     WHERE n.nspname = 'public'
       AND p.proname = 'resolve_table_by_token'
       AND p.prosecdef
       AND p.proconfig IS NULL
  ) THEN
    RAISE EXCEPTION 'security assertion failed: resolve_table_by_token has no pinned search_path';
  END IF;

  IF to_regclass('public.tables_qrcode_key') IS NULL THEN
    RAISE EXCEPTION 'security assertion failed: tables_qrcode_key was not created';
  END IF;
END $$;
