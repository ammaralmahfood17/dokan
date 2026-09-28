-- Phase 4/5 production hardening: foreign-key indexes and RLS init-plan fixes.

-- Composite indexes whose first column is project_id cannot support FK checks
-- on these later columns. Dedicated indexes prevent table scans on deletes.
CREATE INDEX IF NOT EXISTS idx_orders_table_id
  ON public.orders(table_id);
CREATE INDEX IF NOT EXISTS idx_products_category_id
  ON public.products(category_id);
CREATE INDEX IF NOT EXISTS idx_service_requests_table_id
  ON public.service_requests(table_id);
CREATE INDEX IF NOT EXISTS idx_telegram_links_user_id
  ON public.telegram_links(user_id);

-- Cache auth.uid() once per statement rather than recalculating it per row.
DROP POLICY IF EXISTS "Super admins can select subscription_payments"
  ON public.subscription_payments;
CREATE POLICY "Super admins can select subscription_payments"
  ON public.subscription_payments FOR SELECT
  USING (EXISTS (
    SELECT 1
      FROM public.super_admins
     WHERE user_id = (SELECT auth.uid())
  ));

DROP POLICY IF EXISTS "Super admins can insert subscription_payments"
  ON public.subscription_payments;
CREATE POLICY "Super admins can insert subscription_payments"
  ON public.subscription_payments FOR INSERT
  WITH CHECK (EXISTS (
    SELECT 1
      FROM public.super_admins
     WHERE user_id = (SELECT auth.uid())
  ));

-- These two permissive INSERT policies described mutually exclusive cases but
-- forced Postgres to evaluate both for every row. Preserve the exact rules in
-- one policy: owners may add manager/staff, while only a project's creator may
-- claim its first owner membership.
DROP POLICY IF EXISTS staff_insert_by_owner ON public.staff_members;
DROP POLICY IF EXISTS staff_insert_first_owner ON public.staff_members;
CREATE POLICY staff_insert_authorized ON public.staff_members
  FOR INSERT TO authenticated
  WITH CHECK (
    (
      public.is_project_owner(project_id)
      AND role = ANY (ARRAY['manager'::text, 'staff'::text])
    )
    OR
    (
      user_id = (SELECT auth.uid())
      AND role = 'owner'::text
      AND public.project_has_no_members(project_id)
      AND EXISTS (
        SELECT 1
          FROM public.projects AS project
         WHERE project.id = staff_members.project_id
           AND project.created_by = (SELECT auth.uid())
      )
    )
  );

DO $$
BEGIN
  IF (
    SELECT count(*)
      FROM pg_policies
     WHERE schemaname = 'public'
       AND tablename = 'staff_members'
       AND cmd = 'INSERT'
       AND 'authenticated' = ANY (roles)
  ) <> 1 THEN
    RAISE EXCEPTION 'performance assertion failed: staff INSERT policies are duplicated';
  END IF;

  IF EXISTS (
    SELECT required.name
      FROM unnest(ARRAY[
        'idx_orders_table_id',
        'idx_products_category_id',
        'idx_service_requests_table_id',
        'idx_telegram_links_user_id'
      ]) AS required(name)
     WHERE NOT EXISTS (
       SELECT 1
         FROM pg_indexes
        WHERE schemaname = 'public'
          AND indexname = required.name
     )
  ) THEN
    RAISE EXCEPTION 'performance assertion failed: a foreign-key index is missing';
  END IF;
END
$$;
