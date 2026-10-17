-- Migration: restore the two subscription_payments policies that production lost
-- (found while running the repo's own assertions against production, 2026-10-16)
--
-- WHAT WAS FOUND: `pg_policies` on production returns ZERO rows for `subscription_payments`, while
-- the repository's `0010_subscription_payments.sql` creates two policies and
-- `20260928111000_performance_advisor_hardening.sql` recreates them in the cached-`auth.uid()` form.
-- The ledger says both migrations are applied, and `supabase/tests/phase4_5_advisor_hardening.sql`
-- asserts the policies' shape — running that file against production is how the drift surfaced:
--   not ok 8 - subscription payment policies cache auth.uid per statement
-- (`bool_and()` over an empty set returns NULL). `pg_stat_statements` shows the DROP half executed
-- 5 times and the CREATE half 2, i.e. some run left them dropped with no matching create — the same
-- "applied by hand, outside the ledger" pattern this schema has already suffered once.
--
-- WHY RESTORE RATHER THAN ACCEPT THE ABSENCE: the repo, its test and the ledger all describe these
-- policies, so production is the side that diverged. Restoring makes the three agree again, and the
-- statement below is the repository's own text (`20260928111000`), including the per-statement
-- `(SELECT auth.uid())` caching the assertion pins. Nothing else about the table changes.
--
-- CONTEXT (not a reason to skip it): the table has no grants for `anon`/`authenticated` and the
-- super-admin flows reach it through SECURITY DEFINER RPCs, so these policies are unreachable for a
-- web role today — they are restored for correctness of the record, not because a path needs them.
--
-- Rollback:
--   drop policy if exists "Super admins can insert subscription_payments" on public.subscription_payments;
--   drop policy if exists "Super admins can select subscription_payments" on public.subscription_payments;

-- Idempotent in both directions: `drop ... if exists` first, so replaying this file (or applying it
-- to a fresh database where 0010 already created them) can never fail on a duplicate.

drop policy if exists "Super admins can select subscription_payments" on public.subscription_payments;
create policy "Super admins can select subscription_payments"
  on public.subscription_payments
  for select
  to public
  using (
    exists (
      select 1 from public.super_admins
       where user_id = (select auth.uid())
    )
  );

drop policy if exists "Super admins can insert subscription_payments" on public.subscription_payments;
create policy "Super admins can insert subscription_payments"
  on public.subscription_payments
  for insert
  to public
  with check (
    exists (
      select 1 from public.super_admins
       where user_id = (select auth.uid())
    )
  );
