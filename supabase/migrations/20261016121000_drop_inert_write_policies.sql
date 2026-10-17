-- Migration: drop the write policies that cannot allow anything
-- (backend audit B-7, 2026-10-16)
--
-- MEASURED (production catalog): all four of these are INSERT/ALL policies for roles that hold no
-- matching GRANT, and a policy is only consulted AFTER the privilege check — so none of them can
-- permit a write today, and dropping them changes nothing on any request path.
--
--   orders_staff_insert                     INSERT {public}  is_project_member(project_id)
--   order_audit_logs_insert                 INSERT {public}  is_project_member(project_id)
--   "Super admins can insert subscription_payments"  INSERT {public}  EXISTS (SELECT 1 FROM
--       super_admins WHERE user_id = auth.uid())
--   "Super admins can select subscription_payments"  SELECT {public}  (same EXISTS)
--
-- For the first two: `authenticated` holds SELECT ONLY on orders and order_items — at table level
-- AND column level (`information_schema.role_table_grants` / `role_column_privileges`) — so the
-- money path has exactly ONE writer, the service-role RPC. For the last two the predicate can
-- never be true for a web role: `super_admins` has RLS enabled WITH `relforcerowsecurity` and
-- ZERO policies, so a non-service-role SELECT on it returns no rows and the EXISTS is always false.
--
-- WHY DROP INERT THINGS AT ALL: a policy is the strongest signal a reader has about who may write
-- a table, and these read as "authenticated may insert orders". The audit that produced this file
-- spent time proving they were inert; the next one should not have to. And IF a future migration
-- re-grants INSERT (this schema has already suffered that accident once — see 0013), a dropped
-- policy leaves the table fail-CLOSED, whereas an inert-looking one silently re-opens it.
--
-- The privilege boundary is asserted in supabase/tests/phase1_inventory.sql and
-- phase4_5_advisor_hardening.sql, so it is guarded by tests rather than by policy text.
--
-- Rollback (recreates all four verbatim):
--   create policy orders_staff_insert on public.orders for insert
--     with check (is_project_member(project_id));
--   create policy order_audit_logs_insert on public.order_audit_logs for insert
--     with check (is_project_member(project_id));
--   create policy "Super admins can insert subscription_payments" on public.subscription_payments
--     for insert with check (exists (select 1 from public.super_admins where user_id = auth.uid()));
--   create policy "Super admins can select subscription_payments" on public.subscription_payments
--     for select using (exists (select 1 from public.super_admins where user_id = auth.uid()));

drop policy if exists orders_staff_insert on public.orders;
drop policy if exists order_audit_logs_insert on public.order_audit_logs;
drop policy if exists "Super admins can insert subscription_payments" on public.subscription_payments;
drop policy if exists "Super admins can select subscription_payments" on public.subscription_payments;
