-- phase7_realtime.sql — audit 2026-10-05 (Task 2, finding #5), amendment A7.
--
-- Runs on a FRESH database (CI: `supabase db reset` then `supabase test db`), so these
-- assertions describe the schema the migrations create, not production's data.
--
-- What is being protected: the dashboard and the kitchen board subscribe to `orders` with NO
-- project filter (a filter plus RLS on one column made Realtime drop every event). Cross-tenant
-- isolation therefore rests entirely on Realtime honouring RLS for the tables it publishes.
--
-- Proven against production on 2026-10-06 with scripts/realtime-probe.ts (named ids: the
-- subscriber received its own tenant's row and never the foreign tenant's; an anonymous
-- subscriber received nothing). These assertions are what keeps the property true as the
-- schema evolves — assertion 3 is deliberately general: ANY table added to the publication
-- without RLS fails CI, instead of the next audit finding it.

BEGIN;

CREATE EXTENSION IF NOT EXISTS pgtap WITH SCHEMA extensions;

SELECT plan(4);

-- 1. The published tables keep RLS enabled. Without this, Realtime has nothing to filter on
--    and every subscriber receives every tenant's orders.
SELECT ok(
  (
    SELECT bool_and(relrowsecurity)
      FROM pg_class
     WHERE oid IN ('public.orders'::regclass, 'public.order_items'::regclass)
  ),
  'realtime-published tables keep RLS enabled'
);

-- 2. Both stay in the publication — if either silently drops out, the UI stops updating and
--    the failure looks like "realtime is broken" rather than a policy change.
SELECT is(
  (
    SELECT count(*)::integer
      FROM pg_publication_tables
     WHERE pubname = 'supabase_realtime'
       AND schemaname = 'public'
       AND tablename IN ('orders', 'order_items')
  ),
  2,
  'orders + order_items are both in the supabase_realtime publication'
);

-- 3. THE GENERAL GATE: every table in the publication has RLS enabled.
SELECT is(
  (
    SELECT count(*)::integer
      FROM pg_publication_tables pt
      JOIN pg_class c ON c.relname = pt.tablename
      JOIN pg_namespace n ON n.oid = c.relnamespace AND n.nspname = pt.schemaname
     WHERE pt.pubname = 'supabase_realtime'
       AND NOT c.relrowsecurity
  ),
  0,
  'no table is published to Realtime without RLS enabled'
);

-- 4. The publication stays exactly these two tables. A table added by accident is a leak
--    waiting for its first subscriber, and this is the assertion that makes that visible.
SELECT is(
  (
    SELECT count(*)::integer
      FROM pg_publication_tables
     WHERE pubname = 'supabase_realtime' AND schemaname = 'public'
  ),
  2,
  'the realtime publication contains exactly orders + order_items'
);

SELECT * FROM finish();

ROLLBACK;
