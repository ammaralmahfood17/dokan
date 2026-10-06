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
--
-- 2026-10-06: the publication deliberately grew a THIRD table, `service_requests`, so the
-- kitchen board sees a «طلب موظف / طلب فاتورة» the moment it is made instead of on its
-- fallback poll (migration 20261006170000). RLS is enabled on it and its only policy scopes
-- every row to project members, which is what assertion 3 independently checks. Assertion 4
-- is therefore updated to three tables on purpose — it exists to catch an ACCIDENTAL
-- addition, and this one is not accidental.

BEGIN;

CREATE EXTENSION IF NOT EXISTS pgtap WITH SCHEMA extensions;

SELECT plan(4);

-- 1. The published tables keep RLS enabled. Without this, Realtime has nothing to filter on
--    and every subscriber receives every tenant's orders.
SELECT ok(
  (
    SELECT bool_and(relrowsecurity)
      FROM pg_class
     WHERE oid IN (
       'public.orders'::regclass,
       'public.order_items'::regclass,
       'public.service_requests'::regclass
     )
  ),
  'realtime-published tables keep RLS enabled'
);

-- 2. All three stay in the publication — if any silently drops out, the UI stops updating and
--    the failure looks like "realtime is broken" rather than a policy change.
SELECT is(
  (
    SELECT count(*)::integer
      FROM pg_publication_tables
     WHERE pubname = 'supabase_realtime'
       AND schemaname = 'public'
       AND tablename IN ('orders', 'order_items', 'service_requests')
  ),
  3,
  'orders + order_items + service_requests are all in the supabase_realtime publication'
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

-- 4. The publication stays exactly these three tables. A table added by accident is a leak
--    waiting for its first subscriber, and this is the assertion that makes that visible.
SELECT is(
  (
    SELECT count(*)::integer
      FROM pg_publication_tables
     WHERE pubname = 'supabase_realtime' AND schemaname = 'public'
  ),
  3,
  'the realtime publication contains exactly orders + order_items + service_requests'
);

SELECT * FROM finish();

ROLLBACK;
