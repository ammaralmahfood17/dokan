-- Phase 2: enforce tenant RBAC, order state transitions, and atomic rate limits.

-- ---------------------------------------------------------------------------
-- 1. Role helpers. The caller-scoped helper is safe for RLS policies; callers
-- can ask only about their own auth.uid(). The explicit-user variant remains
-- service-role-only for guarded backend RPCs.
-- ---------------------------------------------------------------------------
CREATE OR REPLACE FUNCTION public.has_project_role(
  p_project_id uuid,
  p_roles text[]
)
RETURNS boolean
LANGUAGE sql
STABLE
SECURITY DEFINER
SET search_path = public
AS $$
  SELECT EXISTS (
    SELECT 1
      FROM public.staff_members
     WHERE project_id = p_project_id
       AND user_id = (SELECT auth.uid())
       AND role = ANY (p_roles)
  );
$$;

REVOKE ALL ON FUNCTION public.has_project_role(uuid, text[]) FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION public.has_project_role(uuid, text[]) TO authenticated, service_role;

CREATE OR REPLACE FUNCTION public.has_project_role_for(
  p_user_id uuid,
  p_project_id uuid,
  p_roles text[]
)
RETURNS boolean
LANGUAGE sql
STABLE
SECURITY DEFINER
SET search_path = public
AS $$
  SELECT EXISTS (
    SELECT 1
      FROM public.staff_members
     WHERE project_id = p_project_id
       AND user_id = p_user_id
       AND role = ANY (p_roles)
  );
$$;

REVOKE ALL ON FUNCTION public.has_project_role_for(uuid, uuid, text[])
  FROM PUBLIC, anon, authenticated;
GRANT EXECUTE ON FUNCTION public.has_project_role_for(uuid, uuid, text[]) TO service_role;

-- ---------------------------------------------------------------------------
-- 2. Project settings: owner only. Column grants still limit the writable
-- surface to name/currency/primary_color/is_active.
-- ---------------------------------------------------------------------------
DROP POLICY IF EXISTS projects_update_member ON public.projects;
CREATE POLICY projects_update_owner ON public.projects
  FOR UPDATE TO authenticated
  USING (public.has_project_role(id, ARRAY['owner']))
  WITH CHECK (public.has_project_role(id, ARRAY['owner']));

REVOKE UPDATE ON public.projects FROM authenticated;
GRANT UPDATE (name, currency, primary_color, is_active)
  ON public.projects TO authenticated;

-- ---------------------------------------------------------------------------
-- 3. Catalog management: owner + manager write; every project member keeps
-- read access for POS/KDS/menu-management rendering.
-- ---------------------------------------------------------------------------
DROP POLICY IF EXISTS categories_insert ON public.categories;
DROP POLICY IF EXISTS categories_update ON public.categories;
DROP POLICY IF EXISTS categories_delete ON public.categories;
CREATE POLICY categories_insert ON public.categories
  FOR INSERT TO authenticated
  WITH CHECK (public.has_project_role(project_id, ARRAY['owner', 'manager']));
CREATE POLICY categories_update ON public.categories
  FOR UPDATE TO authenticated
  USING (public.has_project_role(project_id, ARRAY['owner', 'manager']))
  WITH CHECK (public.has_project_role(project_id, ARRAY['owner', 'manager']));
CREATE POLICY categories_delete ON public.categories
  FOR DELETE TO authenticated
  USING (public.has_project_role(project_id, ARRAY['owner', 'manager']));

DROP POLICY IF EXISTS products_insert ON public.products;
DROP POLICY IF EXISTS products_update ON public.products;
DROP POLICY IF EXISTS products_delete ON public.products;
CREATE POLICY products_insert ON public.products
  FOR INSERT TO authenticated
  WITH CHECK (public.has_project_role(project_id, ARRAY['owner', 'manager']));
CREATE POLICY products_update ON public.products
  FOR UPDATE TO authenticated
  USING (public.has_project_role(project_id, ARRAY['owner', 'manager']))
  WITH CHECK (public.has_project_role(project_id, ARRAY['owner', 'manager']));
CREATE POLICY products_delete ON public.products
  FOR DELETE TO authenticated
  USING (public.has_project_role(project_id, ARRAY['owner', 'manager']));

DROP POLICY IF EXISTS addons_insert ON public.product_addons;
DROP POLICY IF EXISTS addons_update ON public.product_addons;
DROP POLICY IF EXISTS addons_delete ON public.product_addons;
CREATE POLICY addons_insert ON public.product_addons
  FOR INSERT TO authenticated
  WITH CHECK (EXISTS (
    SELECT 1 FROM public.products
     WHERE id = product_addons.product_id
       AND public.has_project_role(project_id, ARRAY['owner', 'manager'])
  ));
CREATE POLICY addons_update ON public.product_addons
  FOR UPDATE TO authenticated
  USING (EXISTS (
    SELECT 1 FROM public.products
     WHERE id = product_addons.product_id
       AND public.has_project_role(project_id, ARRAY['owner', 'manager'])
  ))
  WITH CHECK (EXISTS (
    SELECT 1 FROM public.products
     WHERE id = product_addons.product_id
       AND public.has_project_role(project_id, ARRAY['owner', 'manager'])
  ));
CREATE POLICY addons_delete ON public.product_addons
  FOR DELETE TO authenticated
  USING (EXISTS (
    SELECT 1 FROM public.products
     WHERE id = product_addons.product_id
       AND public.has_project_role(project_id, ARRAY['owner', 'manager'])
  ));

DROP POLICY IF EXISTS tables_insert ON public.tables;
DROP POLICY IF EXISTS tables_update ON public.tables;
DROP POLICY IF EXISTS tables_delete ON public.tables;
CREATE POLICY tables_insert ON public.tables
  FOR INSERT TO authenticated
  WITH CHECK (public.has_project_role(project_id, ARRAY['owner', 'manager']));
CREATE POLICY tables_update ON public.tables
  FOR UPDATE TO authenticated
  USING (public.has_project_role(project_id, ARRAY['owner', 'manager']))
  WITH CHECK (public.has_project_role(project_id, ARRAY['owner', 'manager']));
CREATE POLICY tables_delete ON public.tables
  FOR DELETE TO authenticated
  USING (public.has_project_role(project_id, ARRAY['owner', 'manager']));

REVOKE INSERT, UPDATE, DELETE ON public.categories FROM anon;
REVOKE INSERT, UPDATE, DELETE ON public.products FROM anon;
REVOKE INSERT, UPDATE, DELETE ON public.product_addons FROM anon;
REVOKE INSERT, UPDATE, DELETE ON public.tables FROM anon;

GRANT INSERT, UPDATE, DELETE ON public.categories TO authenticated;
GRANT INSERT, UPDATE, DELETE ON public.products TO authenticated;
GRANT INSERT, UPDATE, DELETE ON public.product_addons TO authenticated;
GRANT INSERT, UPDATE, DELETE ON public.tables TO authenticated;

-- ---------------------------------------------------------------------------
-- 4. Orders are immutable to direct browser DML. All status writes go through
-- advance_order_status, which serializes, validates, and audits the transition.
-- ---------------------------------------------------------------------------
DROP POLICY IF EXISTS orders_staff_update_status ON public.orders;
DROP POLICY IF EXISTS order_items_staff_all ON public.order_items;
CREATE POLICY order_items_staff_select ON public.order_items
  FOR SELECT TO authenticated
  USING (EXISTS (
    SELECT 1 FROM public.orders
     WHERE id = order_items.order_id
       AND public.is_project_member(project_id)
  ));

REVOKE INSERT, UPDATE, DELETE ON public.orders FROM anon, authenticated;
REVOKE INSERT, UPDATE, DELETE ON public.order_items FROM anon, authenticated;

DO $$
DECLARE
  v_column text;
BEGIN
  FOR v_column IN
    SELECT attname
      FROM pg_attribute
     WHERE attrelid = 'public.orders'::regclass
       AND attnum > 0
       AND NOT attisdropped
  LOOP
    EXECUTE format(
      'REVOKE INSERT (%I), UPDATE (%I) ON public.orders FROM anon, authenticated',
      v_column,
      v_column
    );
  END LOOP;

  FOR v_column IN
    SELECT attname
      FROM pg_attribute
     WHERE attrelid = 'public.order_items'::regclass
       AND attnum > 0
       AND NOT attisdropped
  LOOP
    EXECUTE format(
      'REVOKE INSERT (%I), UPDATE (%I) ON public.order_items FROM anon, authenticated',
      v_column,
      v_column
    );
  END LOOP;
END
$$;

CREATE OR REPLACE FUNCTION public.advance_order_status(
  p_order_id uuid,
  p_expected_status text,
  p_new_status text,
  p_caller_user_id uuid DEFAULT NULL
)
RETURNS jsonb
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  v_project_id uuid;
  v_current_status public.order_status;
  v_caller uuid;
  v_event text;
BEGIN
  SELECT project_id, status
    INTO v_project_id, v_current_status
    FROM public.orders
   WHERE id = p_order_id
   FOR UPDATE;

  IF NOT FOUND THEN
    RAISE EXCEPTION 'order not found' USING ERRCODE = 'P0002';
  END IF;

  v_caller := auth.uid();
  IF v_caller IS NULL AND auth.role() = 'service_role' THEN
    v_caller := p_caller_user_id;
  END IF;

  IF v_caller IS NULL OR NOT public.is_project_member_for(v_caller, v_project_id) THEN
    RAISE EXCEPTION 'not authorized for this project' USING ERRCODE = '42501';
  END IF;

  IF v_current_status::text <> p_expected_status THEN
    RAISE EXCEPTION 'STALE_STATUS: order state changed on another device'
      USING ERRCODE = 'P0001';
  END IF;

  IF NOT (
    (v_current_status = 'pending'   AND p_new_status IN ('preparing', 'cancelled')) OR
    (v_current_status = 'preparing' AND p_new_status IN ('ready', 'cancelled')) OR
    (v_current_status = 'ready'     AND p_new_status IN ('delivered', 'cancelled'))
  ) THEN
    RAISE EXCEPTION 'INVALID_TRANSITION: % -> %', v_current_status, p_new_status
      USING ERRCODE = '22023';
  END IF;

  UPDATE public.orders
     SET status = p_new_status::public.order_status
   WHERE id = p_order_id;

  IF p_new_status IN ('preparing', 'ready') THEN
    UPDATE public.order_items
       SET status = p_new_status
     WHERE order_id = p_order_id;
  END IF;

  v_event := CASE WHEN p_new_status = 'cancelled' THEN 'cancelled' ELSE 'status_changed' END;
  INSERT INTO public.order_audit_logs (
    order_id,
    project_id,
    event,
    old_status,
    new_status,
    actor_user_id,
    metadata
  ) VALUES (
    p_order_id,
    v_project_id,
    v_event,
    v_current_status::text,
    p_new_status,
    v_caller,
    jsonb_build_object('source', 'advance_order_status')
  );

  RETURN jsonb_build_object(
    'id', p_order_id,
    'old_status', v_current_status,
    'status', p_new_status
  );
END
$$;

REVOKE ALL ON FUNCTION public.advance_order_status(uuid, text, text, uuid)
  FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION public.advance_order_status(uuid, text, text, uuid)
  TO authenticated, service_role;

-- ---------------------------------------------------------------------------
-- 5. Atomic rate limit. One UPSERT is the serialization point; concurrent
-- callers can no longer read the same count and all pass before incrementing.
-- ---------------------------------------------------------------------------
CREATE OR REPLACE FUNCTION public.rate_limit_check(
  p_key text,
  p_limit integer,
  p_window_ms integer,
  p_project_id uuid DEFAULT NULL,
  p_caller_user_id uuid DEFAULT NULL
)
RETURNS json
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  v_count integer;
  v_reset_at timestamptz;
  v_now timestamptz := clock_timestamp();
  v_caller uuid;
  v_allowed boolean;
BEGIN
  IF p_key IS NULL OR length(p_key) = 0 OR length(p_key) > 500 THEN
    RAISE EXCEPTION 'invalid rate-limit key' USING ERRCODE = '22023';
  END IF;
  IF p_limit <= 0 OR p_window_ms <= 0 THEN
    RAISE EXCEPTION 'invalid rate-limit configuration' USING ERRCODE = '22023';
  END IF;

  DELETE FROM public.rate_limits
   WHERE ctid IN (
     SELECT ctid
       FROM public.rate_limits
      WHERE reset_at < v_now - interval '24 hours'
      LIMIT 200
   );

  IF p_project_id IS NOT NULL THEN
    v_caller := auth.uid();
    IF v_caller IS NULL AND auth.role() = 'service_role' THEN
      v_caller := p_caller_user_id;
    END IF;
    IF v_caller IS NOT NULL
       AND NOT public.is_project_member_for(v_caller, p_project_id) THEN
      RAISE EXCEPTION 'not authorized for this project' USING ERRCODE = '42501';
    END IF;
  END IF;

  INSERT INTO public.rate_limits AS current_window (key, count, reset_at)
  VALUES (
    p_key,
    1,
    v_now + make_interval(secs => p_window_ms::double precision / 1000.0)
  )
  ON CONFLICT (key) DO UPDATE
    SET count = CASE
          WHEN current_window.reset_at <= v_now THEN 1
          ELSE least(current_window.count + 1, p_limit + 1)
        END,
        reset_at = CASE
          WHEN current_window.reset_at <= v_now
            THEN v_now + make_interval(secs => p_window_ms::double precision / 1000.0)
          ELSE current_window.reset_at
        END
  RETURNING count, reset_at INTO v_count, v_reset_at;

  v_allowed := v_count <= p_limit;
  RETURN json_build_object(
    'allowed', v_allowed,
    'remaining', greatest(0, p_limit - v_count),
    'reset_in', greatest(0, extract(epoch FROM (v_reset_at - v_now)) * 1000)
  );
END
$$;

REVOKE ALL ON FUNCTION public.rate_limit_check(text, integer, integer, uuid, uuid)
  FROM PUBLIC, anon, authenticated;
GRANT EXECUTE ON FUNCTION public.rate_limit_check(text, integer, integer, uuid, uuid)
  TO service_role;

-- ---------------------------------------------------------------------------
-- 6. Deployment assertions.
-- ---------------------------------------------------------------------------
DO $$
BEGIN
  IF has_table_privilege('authenticated', 'public.orders', 'UPDATE')
     OR has_column_privilege('authenticated', 'public.orders', 'status', 'UPDATE') THEN
    RAISE EXCEPTION 'security assertion failed: direct authenticated order updates remain';
  END IF;

  IF has_table_privilege('authenticated', 'public.order_items', 'UPDATE')
     OR has_column_privilege('authenticated', 'public.order_items', 'status', 'UPDATE') THEN
    RAISE EXCEPTION 'security assertion failed: direct authenticated order-item updates remain';
  END IF;

  IF NOT has_function_privilege(
    'authenticated',
    'public.advance_order_status(uuid,text,text,uuid)',
    'EXECUTE'
  ) THEN
    RAISE EXCEPTION 'security assertion failed: guarded order transition RPC unavailable';
  END IF;

  IF has_function_privilege(
    'authenticated',
    'public.rate_limit_check(text,integer,integer,uuid,uuid)',
    'EXECUTE'
  ) THEN
    RAISE EXCEPTION 'security assertion failed: rate limiter exposed to authenticated callers';
  END IF;
END
$$;
