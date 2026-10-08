-- Phase 1 ingredient inventory.
-- Quantities are stored in one base unit per ingredient (g, ml, or each); no
-- implicit unit conversion can silently change recipe consumption.

CREATE TABLE public.suppliers (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  project_id uuid NOT NULL REFERENCES public.projects(id) ON DELETE CASCADE,
  name text NOT NULL CHECK (char_length(btrim(name)) BETWEEN 1 AND 120),
  contact_name text CHECK (contact_name IS NULL OR char_length(contact_name) <= 120),
  email text CHECK (email IS NULL OR char_length(email) <= 254),
  phone text CHECK (phone IS NULL OR char_length(phone) <= 40),
  notes text CHECK (notes IS NULL OR char_length(notes) <= 500),
  created_at timestamptz NOT NULL DEFAULT now(),
  CONSTRAINT suppliers_id_project_id_key UNIQUE (id, project_id)
);

ALTER TABLE public.products
  ADD CONSTRAINT products_id_project_id_key UNIQUE (id, project_id);

-- Orders created before this migration did not reliably decrement portion
-- stock. Mark only new, actually-decremented lines so a later cancellation
-- cannot add stock back for legacy orders that never consumed it.
ALTER TABLE public.order_items
  ADD COLUMN portion_stock_deducted boolean NOT NULL DEFAULT false;

CREATE TABLE public.ingredients (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  project_id uuid NOT NULL REFERENCES public.projects(id) ON DELETE CASCADE,
  name text NOT NULL CHECK (char_length(btrim(name)) BETWEEN 1 AND 120),
  unit text NOT NULL CHECK (unit IN ('g', 'ml', 'each')),
  quantity_on_hand numeric(14,3) NOT NULL DEFAULT 0 CHECK (quantity_on_hand >= 0),
  reorder_point numeric(14,3) NOT NULL DEFAULT 0 CHECK (reorder_point >= 0),
  supplier_id uuid,
  supplier_sku text CHECK (supplier_sku IS NULL OR char_length(supplier_sku) <= 100),
  created_at timestamptz NOT NULL DEFAULT now(),
  CONSTRAINT ingredients_id_project_id_key UNIQUE (id, project_id),
  CONSTRAINT ingredients_supplier_project_fkey
    FOREIGN KEY (supplier_id, project_id)
    REFERENCES public.suppliers (id, project_id) ON DELETE RESTRICT
);

CREATE TABLE public.product_ingredients (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  project_id uuid NOT NULL REFERENCES public.projects(id) ON DELETE CASCADE,
  product_id uuid NOT NULL,
  ingredient_id uuid NOT NULL,
  quantity_per_product numeric(14,3) NOT NULL CHECK (quantity_per_product > 0),
  created_at timestamptz NOT NULL DEFAULT now(),
  CONSTRAINT product_ingredients_product_project_fkey
    FOREIGN KEY (product_id, project_id)
    REFERENCES public.products (id, project_id) ON DELETE CASCADE,
  CONSTRAINT product_ingredients_ingredient_project_fkey
    FOREIGN KEY (ingredient_id, project_id)
    REFERENCES public.ingredients (id, project_id) ON DELETE RESTRICT,
  CONSTRAINT product_ingredients_product_ingredient_key UNIQUE (product_id, ingredient_id)
);

CREATE TABLE public.inventory_movements (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  project_id uuid NOT NULL REFERENCES public.projects(id) ON DELETE CASCADE,
  ingredient_id uuid NOT NULL,
  order_id uuid REFERENCES public.orders(id) ON DELETE SET NULL,
  movement_type text NOT NULL CHECK (
    movement_type IN ('receive', 'adjustment', 'consume', 'restore')
  ),
  quantity_delta numeric(14,3) NOT NULL CHECK (quantity_delta <> 0),
  stock_after numeric(14,3) NOT NULL CHECK (stock_after >= 0),
  unit text NOT NULL CHECK (unit IN ('g', 'ml', 'each')),
  notes text CHECK (notes IS NULL OR char_length(notes) <= 500),
  actor_user_id uuid REFERENCES auth.users(id) ON DELETE SET NULL,
  created_at timestamptz NOT NULL DEFAULT now(),
  CONSTRAINT inventory_movements_ingredient_project_fkey
    FOREIGN KEY (ingredient_id, project_id)
    REFERENCES public.ingredients (id, project_id) ON DELETE RESTRICT,
  CONSTRAINT inventory_movements_type_sign_check CHECK (
    (movement_type IN ('receive', 'restore') AND quantity_delta > 0)
    OR (movement_type = 'consume' AND quantity_delta < 0)
    OR movement_type = 'adjustment'
  )
);

CREATE INDEX suppliers_project_id_idx ON public.suppliers(project_id);
CREATE INDEX ingredients_project_id_name_idx ON public.ingredients(project_id, name);
CREATE INDEX product_ingredients_project_product_idx
  ON public.product_ingredients(project_id, product_id);
CREATE INDEX product_ingredients_project_ingredient_idx
  ON public.product_ingredients(project_id, ingredient_id);
CREATE INDEX inventory_movements_project_created_idx
  ON public.inventory_movements(project_id, created_at DESC);
CREATE UNIQUE INDEX inventory_movements_order_once_idx
  ON public.inventory_movements(order_id, ingredient_id, movement_type)
  WHERE order_id IS NOT NULL AND movement_type IN ('consume', 'restore');
-- One index per FOREIGN KEY column, leading. supabase/tests/phase7_no_permissive.sql
-- asserts "every foreign key in public has a covering index" and it reads
-- pg_index.indkey[0], so a composite FK is only covered when an index STARTS with
-- that column. Without these, every foreign-key check on the four new tables is a
-- sequential scan. (The test failed with 1 uncovered FK on CI.)
CREATE INDEX ingredients_supplier_project_idx
  ON public.ingredients(supplier_id, project_id);
CREATE INDEX product_ingredients_product_project_idx
  ON public.product_ingredients(product_id, project_id);
CREATE INDEX product_ingredients_ingredient_project_idx
  ON public.product_ingredients(ingredient_id, project_id);
CREATE INDEX inventory_movements_ingredient_project_idx
  ON public.inventory_movements(ingredient_id, project_id);
CREATE INDEX inventory_movements_order_id_idx
  ON public.inventory_movements(order_id);
CREATE INDEX inventory_movements_actor_user_id_idx
  ON public.inventory_movements(actor_user_id);

ALTER TABLE public.suppliers ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.ingredients ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.product_ingredients ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.inventory_movements ENABLE ROW LEVEL SECURITY;

REVOKE ALL ON public.suppliers, public.ingredients,
  public.product_ingredients, public.inventory_movements FROM PUBLIC, anon;

GRANT SELECT, INSERT, UPDATE, DELETE ON public.suppliers TO authenticated;
GRANT SELECT ON public.ingredients, public.product_ingredients,
  public.inventory_movements TO authenticated;
-- `id` is granted because the column-level grant below lists columns explicitly, and a
-- column grant is an ALLOW-list: an INSERT naming any other column is rejected. The UI
-- relies on the DEFAULT gen_random_uuid() and never sends an id, but the pgtap suite
-- seeds deterministic ids, and Supabase clients may send one. Without it in this list,
-- "manager can add an ingredient without setting its balance directly" fails on
-- permission denied for column id.
GRANT INSERT (id, project_id, name, unit, reorder_point, supplier_id, supplier_sku)
  ON public.ingredients TO authenticated;
GRANT UPDATE (name, reorder_point, supplier_id, supplier_sku)
  ON public.ingredients TO authenticated;
GRANT DELETE ON public.ingredients TO authenticated;
GRANT ALL ON public.suppliers, public.ingredients, public.product_ingredients,
  public.inventory_movements TO service_role;

CREATE POLICY suppliers_member_read ON public.suppliers
  FOR SELECT TO authenticated
  USING (public.is_project_member(project_id));
CREATE POLICY suppliers_manager_insert ON public.suppliers
  FOR INSERT TO authenticated
  WITH CHECK (public.has_project_role(project_id, ARRAY['owner', 'manager']));
CREATE POLICY suppliers_manager_update ON public.suppliers
  FOR UPDATE TO authenticated
  USING (public.has_project_role(project_id, ARRAY['owner', 'manager']))
  WITH CHECK (public.has_project_role(project_id, ARRAY['owner', 'manager']));
CREATE POLICY suppliers_manager_delete ON public.suppliers
  FOR DELETE TO authenticated
  USING (public.has_project_role(project_id, ARRAY['owner', 'manager']));

CREATE POLICY ingredients_member_read ON public.ingredients
  FOR SELECT TO authenticated
  USING (public.is_project_member(project_id));
CREATE POLICY ingredients_manager_insert ON public.ingredients
  FOR INSERT TO authenticated
  WITH CHECK (public.has_project_role(project_id, ARRAY['owner', 'manager']));
CREATE POLICY ingredients_manager_update ON public.ingredients
  FOR UPDATE TO authenticated
  USING (public.has_project_role(project_id, ARRAY['owner', 'manager']))
  WITH CHECK (public.has_project_role(project_id, ARRAY['owner', 'manager']));
CREATE POLICY ingredients_manager_delete ON public.ingredients
  FOR DELETE TO authenticated
  USING (public.has_project_role(project_id, ARRAY['owner', 'manager']));

CREATE POLICY product_ingredients_member_read ON public.product_ingredients
  FOR SELECT TO authenticated
  USING (public.is_project_member(project_id));

CREATE POLICY inventory_movements_manager_read ON public.inventory_movements
  FOR SELECT TO authenticated
  USING (public.has_project_role(project_id, ARRAY['owner', 'manager']));

CREATE OR REPLACE FUNCTION public.replace_product_recipe(
  p_product_id uuid,
  p_lines jsonb
)
RETURNS jsonb
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  v_project_id uuid;
  v_line jsonb;
  v_ingredient_id uuid;
  v_quantity numeric;
  v_line_count integer := 0;
BEGIN
  SELECT p.project_id INTO v_project_id
    FROM public.products p
   WHERE p.id = p_product_id
   FOR UPDATE;
  IF NOT FOUND THEN
    RAISE EXCEPTION 'PRODUCT_NOT_FOUND' USING ERRCODE = 'P0001';
  END IF;
  IF auth.uid() IS NULL
     OR NOT public.has_project_role(v_project_id, ARRAY['owner', 'manager']) THEN
    RAISE EXCEPTION 'not authorized for this project' USING ERRCODE = '42501';
  END IF;
  IF p_lines IS NULL OR jsonb_typeof(p_lines) <> 'array' THEN
    RAISE EXCEPTION 'INVALID_RECIPE' USING ERRCODE = '22023';
  END IF;
  IF jsonb_array_length(p_lines) > 50 THEN
    RAISE EXCEPTION 'INVALID_RECIPE' USING ERRCODE = '22023';
  END IF;
  IF EXISTS (
    SELECT 1
      FROM jsonb_array_elements(p_lines) AS x(value)
     GROUP BY x.value ->> 'ingredient_id'
    HAVING count(*) > 1
  ) THEN
    RAISE EXCEPTION 'DUPLICATE_RECIPE_INGREDIENT' USING ERRCODE = '22023';
  END IF;

  -- Validate the whole replacement before deleting the current recipe.
  FOR v_line IN SELECT value FROM jsonb_array_elements(p_lines)
  LOOP
    v_line_count := v_line_count + 1;
    IF coalesce(v_line ->> 'ingredient_id', '') !~
       '^[0-9a-fA-F]{8}-[0-9a-fA-F]{4}-[0-9a-fA-F]{4}-[0-9a-fA-F]{4}-[0-9a-fA-F]{12}$'
       OR coalesce(v_line ->> 'quantity', '') !~ '^[0-9]+(\.[0-9]{1,3})?$' THEN
      RAISE EXCEPTION 'INVALID_RECIPE' USING ERRCODE = '22023';
    END IF;
    v_ingredient_id := (v_line ->> 'ingredient_id')::uuid;
    v_quantity := (v_line ->> 'quantity')::numeric;
    IF v_quantity <= 0 OR v_quantity > 1000000000
       OR NOT EXISTS (
         SELECT 1 FROM public.ingredients i
          WHERE i.id = v_ingredient_id AND i.project_id = v_project_id
       ) THEN
      RAISE EXCEPTION 'INVALID_RECIPE_INGREDIENT' USING ERRCODE = '22023';
    END IF;
  END LOOP;

  DELETE FROM public.product_ingredients
   WHERE project_id = v_project_id AND product_id = p_product_id;

  FOR v_line IN SELECT value FROM jsonb_array_elements(p_lines)
  LOOP
    INSERT INTO public.product_ingredients (
      project_id, product_id, ingredient_id, quantity_per_product
    ) VALUES (
      v_project_id,
      p_product_id,
      (v_line ->> 'ingredient_id')::uuid,
      (v_line ->> 'quantity')::numeric
    );
  END LOOP;

  RETURN jsonb_build_object('product_id', p_product_id, 'ingredient_count', v_line_count);
END;
$$;

REVOKE ALL ON FUNCTION public.replace_product_recipe(uuid, jsonb) FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION public.replace_product_recipe(uuid, jsonb) TO authenticated;
GRANT EXECUTE ON FUNCTION public.replace_product_recipe(uuid, jsonb) TO service_role;

CREATE OR REPLACE FUNCTION public.adjust_ingredient_stock(
  p_ingredient_id uuid,
  p_movement_type text,
  p_quantity numeric,
  p_notes text DEFAULT NULL
)
RETURNS jsonb
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  v_project_id uuid;
  v_unit text;
  v_current numeric(14,3);
  v_next numeric(14,3);
  v_actor uuid := auth.uid();
BEGIN
  IF v_actor IS NULL THEN
    RAISE EXCEPTION 'not authorized' USING ERRCODE = '42501';
  END IF;
  IF p_movement_type IS NULL
     OR p_movement_type NOT IN ('receive', 'adjustment')
     OR p_quantity IS NULL
     OR p_quantity = 0
     OR p_quantity <> round(p_quantity, 3)
     OR (p_movement_type = 'receive' AND p_quantity < 0)
     OR abs(p_quantity) > 1000000000
     OR char_length(coalesce(p_notes, '')) > 500 THEN
    RAISE EXCEPTION 'INVALID_STOCK_MOVEMENT' USING ERRCODE = '22023';
  END IF;

  SELECT i.project_id, i.unit, i.quantity_on_hand
    INTO v_project_id, v_unit, v_current
    FROM public.ingredients i
   WHERE i.id = p_ingredient_id
   FOR UPDATE;
  IF NOT FOUND THEN
    RAISE EXCEPTION 'INGREDIENT_NOT_FOUND' USING ERRCODE = 'P0001';
  END IF;
  IF NOT public.has_project_role(v_project_id, ARRAY['owner', 'manager']) THEN
    RAISE EXCEPTION 'not authorized for this project' USING ERRCODE = '42501';
  END IF;

  v_next := v_current + p_quantity;
  IF v_next < 0 THEN
    RAISE EXCEPTION 'INSUFFICIENT_INGREDIENT_STOCK' USING ERRCODE = 'P0001';
  END IF;

  UPDATE public.ingredients
     SET quantity_on_hand = v_next
   WHERE id = p_ingredient_id;

  INSERT INTO public.inventory_movements (
    project_id, ingredient_id, movement_type, quantity_delta,
    stock_after, unit, notes, actor_user_id
  ) VALUES (
    v_project_id, p_ingredient_id, p_movement_type, p_quantity,
    v_next, v_unit, nullif(btrim(p_notes), ''), v_actor
  );

  RETURN jsonb_build_object(
    'ingredient_id', p_ingredient_id,
    'quantity_on_hand', v_next,
    'unit', v_unit
  );
END;
$$;

REVOKE ALL ON FUNCTION public.adjust_ingredient_stock(uuid, text, numeric, text)
  FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION public.adjust_ingredient_stock(uuid, text, numeric, text)
  TO authenticated, service_role;

-- Keep order creation, portion stock, recipe stock, and the stock ledger in a
-- single transaction. The advisory lock serializes only identical public retry
-- keys; product and ingredient rows are then locked in deterministic order.
CREATE OR REPLACE FUNCTION public.create_order_transactional(
  p_project_id uuid,
  p_type text,
  p_status text,
  p_total_amount numeric,
  p_order_number integer,
  p_items jsonb,
  p_table_id uuid DEFAULT NULL::uuid,
  p_notes text DEFAULT NULL::text,
  p_caller_user_id uuid DEFAULT NULL::uuid,
  p_client_request_id uuid DEFAULT NULL::uuid
)
RETURNS jsonb
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $function$
DECLARE
  v_order_id uuid;
  v_order_number integer;
  v_caller uuid;
  v_existing public.orders%ROWTYPE;
  v_dec integer;
  v_rec record;
  v_prod_id uuid;
  v_prod_price numeric;
  v_prod_avail boolean;
  v_prod_project uuid;
  v_prod_name text;
  v_prod_stock integer;
  v_qty integer;
  v_option_ids uuid[];
  v_option_found integer;
  v_option_total numeric;
  v_options_json jsonb;
  v_unit numeric;
  v_total numeric := 0;
  v_lines jsonb := '[]'::jsonb;
  v_line jsonb;
  v_stock numeric(14,3);
  v_after numeric(14,3);
BEGIN
  v_caller := auth.uid();
  IF v_caller IS NULL AND auth.role() = 'service_role' THEN
    v_caller := p_caller_user_id;
  END IF;
  IF v_caller IS NOT NULL
     AND NOT public.is_project_member_for(v_caller, p_project_id) THEN
    RAISE EXCEPTION 'not authorized for this project' USING ERRCODE = '42501';
  END IF;

  IF p_client_request_id IS NOT NULL THEN
    PERFORM pg_advisory_xact_lock(
      hashtext(p_project_id::text),
      hashtext(p_client_request_id::text)
    );
    SELECT * INTO v_existing
      FROM public.orders
     WHERE project_id = p_project_id
       AND client_request_id = p_client_request_id;
    IF FOUND THEN
      RETURN jsonb_build_object(
        'id', v_existing.id,
        'status', v_existing.status,
        'total_amount', v_existing.total_amount,
        'order_number', v_existing.order_number,
        'replayed', true
      );
    END IF;
  END IF;

  SELECT CASE WHEN upper(coalesce(currency, '')) IN ('BHD', 'KWD', 'OMR')
    THEN 3 ELSE 2 END
    INTO v_dec
    FROM public.projects
   WHERE id = p_project_id;
  IF v_dec IS NULL THEN
    RAISE EXCEPTION 'PROJECT_NOT_FOUND' USING ERRCODE = 'P0001';
  END IF;
  IF p_items IS NULL OR jsonb_typeof(p_items) <> 'array'
     OR jsonb_array_length(p_items) = 0 THEN
    RAISE EXCEPTION 'EMPTY_CART' USING ERRCODE = 'P0001';
  END IF;

  -- Reprice against the current catalog. FOR UPDATE both preserves portion
  -- stock safety and serializes recipe edits for every product in the cart.
  FOR v_rec IN
    SELECT e.value AS item, e.ord
      FROM jsonb_array_elements(p_items) WITH ORDINALITY AS e(value, ord)
     ORDER BY e.value ->> 'product_id'
  LOOP
    IF coalesce(v_rec.item ->> 'product_id', '') !~
       '^[0-9a-fA-F]{8}-[0-9a-fA-F]{4}-[0-9a-fA-F]{4}-[0-9a-fA-F]{4}-[0-9a-fA-F]{12}$' THEN
      RAISE EXCEPTION 'INVALID_LINE' USING ERRCODE = 'P0001';
    END IF;
    v_prod_id := (v_rec.item ->> 'product_id')::uuid;
    IF coalesce(v_rec.item ->> 'quantity', '') !~ '^[0-9]{1,3}$' THEN
      RAISE EXCEPTION 'INVALID_LINE' USING ERRCODE = 'P0001';
    END IF;
    v_qty := (v_rec.item ->> 'quantity')::integer;
    IF v_qty <= 0 OR v_qty > 99 THEN
      RAISE EXCEPTION 'INVALID_LINE' USING ERRCODE = 'P0001';
    END IF;

    SELECT p.price, p.is_available, p.project_id, p.name, p.stock
      INTO v_prod_price, v_prod_avail, v_prod_project, v_prod_name, v_prod_stock
      FROM public.products p
     WHERE p.id = v_prod_id
     FOR UPDATE;
    IF NOT FOUND OR v_prod_project IS DISTINCT FROM p_project_id THEN
      RAISE EXCEPTION 'PRODUCT_NOT_FOUND' USING ERRCODE = 'P0001';
    END IF;
    IF NOT v_prod_avail THEN
      RAISE EXCEPTION 'ITEM_UNAVAILABLE: %', v_prod_name USING ERRCODE = 'P0001';
    END IF;

    v_option_ids := array(
      SELECT (e ->> 'id')::uuid
        FROM jsonb_array_elements(coalesce(v_rec.item -> 'addons', '[]'::jsonb)) e
       WHERE coalesce(e ->> 'id', '') ~
         '^[0-9a-fA-F]{8}-[0-9a-fA-F]{4}-[0-9a-fA-F]{4}-[0-9a-fA-F]{4}-[0-9a-fA-F]{12}$'
    );
    IF v_option_ids IS NULL OR array_length(v_option_ids, 1) IS NULL THEN
      v_option_total := 0;
      v_options_json := '[]'::jsonb;
    ELSE
      SELECT coalesce(sum(round(c.price, v_dec)), 0), count(*)
        INTO v_option_total, v_option_found
        FROM public.option_choices c
        JOIN public.option_groups g ON g.id = c.group_id
       WHERE c.id = ANY(v_option_ids)
         AND g.product_id = v_prod_id
         AND c.is_available;
      IF v_option_found <> array_length(v_option_ids, 1) THEN
        RAISE EXCEPTION 'OPTION_UNAVAILABLE' USING ERRCODE = 'P0001';
      END IF;

      IF EXISTS (
        SELECT 1
          FROM public.option_groups g
          JOIN public.option_choices c
            ON c.group_id = g.id AND c.is_available
         WHERE g.product_id = v_prod_id
         GROUP BY g.id, g.min_select, g.max_select
        HAVING count(*) FILTER (WHERE c.id = ANY(v_option_ids))
                 < least(g.min_select, count(*))
            OR count(*) FILTER (WHERE c.id = ANY(v_option_ids))
                 > greatest(1, least(g.max_select, count(*)))
      ) THEN
        RAISE EXCEPTION 'OPTION_SELECTION_INVALID' USING ERRCODE = 'P0001';
      END IF;

      SELECT coalesce(
        jsonb_agg(
          jsonb_build_object('id', c.id, 'name', c.name, 'price', round(c.price, v_dec))
          ORDER BY u.ord
        ),
        '[]'::jsonb
      )
        INTO v_options_json
        FROM unnest(v_option_ids) WITH ORDINALITY AS u(cid, ord)
        JOIN public.option_choices c ON c.id = u.cid;
    END IF;

    v_unit := round(v_prod_price + v_option_total, v_dec);
    v_total := v_total + round(v_unit * v_qty, v_dec);
    v_lines := v_lines || jsonb_build_object(
      'ord', v_rec.ord,
      'product_id', v_prod_id,
      'product_name', v_prod_name,
      'quantity', v_qty,
      'unit_price', v_unit,
      'addons', v_options_json,
      'notes', nullif(left(coalesce(v_rec.item ->> 'notes', ''), 200), '')
    );
  END LOOP;
  v_total := round(v_total, v_dec);

  BEGIN
    INSERT INTO public.orders (
      project_id, table_id, type, status, total_amount, notes, order_number,
      client_request_id
    ) VALUES (
      p_project_id, p_table_id, p_type::public.order_type,
      p_status::public.order_status, v_total, left(p_notes, 500), 0,
      p_client_request_id
    )
    RETURNING id, order_number INTO v_order_id, v_order_number;
  EXCEPTION WHEN unique_violation THEN
    IF p_client_request_id IS NULL THEN
      RAISE;
    END IF;
    SELECT * INTO v_existing
      FROM public.orders
     WHERE project_id = p_project_id
       AND client_request_id = p_client_request_id;
    IF NOT FOUND THEN
      RAISE;
    END IF;
    RETURN jsonb_build_object(
      'id', v_existing.id,
      'status', v_existing.status,
      'total_amount', v_existing.total_amount,
      'order_number', v_existing.order_number,
      'replayed', true
    );
  END;

  -- Decrement legacy portion stock once per product, aggregating duplicate cart
  -- lines. Any failure rolls the newly inserted order back with the transaction.
  FOR v_rec IN
    SELECT (x.value ->> 'product_id')::uuid AS product_id,
           sum((x.value ->> 'quantity')::integer)::integer AS quantity
      FROM jsonb_array_elements(v_lines) AS x(value)
     GROUP BY (x.value ->> 'product_id')::uuid
     ORDER BY (x.value ->> 'product_id')::uuid
  LOOP
    SELECT p.stock, p.name INTO v_prod_stock, v_prod_name
      FROM public.products p
     WHERE p.id = v_rec.product_id
     FOR UPDATE;
    IF v_prod_stock IS NOT NULL THEN
      IF v_prod_stock < v_rec.quantity THEN
        RAISE EXCEPTION 'OUT_OF_STOCK: % (باقي %)', v_prod_name, v_prod_stock
          USING ERRCODE = 'P0001';
      END IF;
      UPDATE public.products
         SET stock = stock - v_rec.quantity
       WHERE id = v_rec.product_id;
    END IF;
  END LOOP;

  -- Aggregate every recipe requirement for the full cart and lock ingredients
  -- by UUID. Thus carts with overlapping recipes cannot deadlock or oversell.
  FOR v_rec IN
    SELECT i.id AS ingredient_id,
           i.name,
           i.unit,
           sum(pi.quantity_per_product * (x.value ->> 'quantity')::numeric) AS needed
      FROM jsonb_array_elements(v_lines) AS x(value)
      JOIN public.product_ingredients pi
        ON pi.product_id = (x.value ->> 'product_id')::uuid
       AND pi.project_id = p_project_id
      JOIN public.ingredients i
        ON i.id = pi.ingredient_id
       AND i.project_id = p_project_id
     GROUP BY i.id, i.name, i.unit
     ORDER BY i.id
  LOOP
    SELECT i.quantity_on_hand INTO v_stock
      FROM public.ingredients i
     WHERE i.id = v_rec.ingredient_id
       AND i.project_id = p_project_id
     FOR UPDATE;
    IF v_stock < v_rec.needed THEN
      RAISE EXCEPTION 'OUT_OF_INGREDIENT_STOCK: % (باقي % %)',
        v_rec.name, v_stock, v_rec.unit USING ERRCODE = 'P0001';
    END IF;

    UPDATE public.ingredients
       SET quantity_on_hand = quantity_on_hand - v_rec.needed
     WHERE id = v_rec.ingredient_id
     RETURNING quantity_on_hand INTO v_after;

    INSERT INTO public.inventory_movements (
      project_id, ingredient_id, order_id, movement_type,
      quantity_delta, stock_after, unit, actor_user_id
    ) VALUES (
      p_project_id, v_rec.ingredient_id, v_order_id, 'consume',
      -v_rec.needed, v_after, v_rec.unit, v_caller
    );
  END LOOP;

  FOR v_line IN
    SELECT value FROM jsonb_array_elements(v_lines)
     ORDER BY (value ->> 'ord')::integer
  LOOP
    INSERT INTO public.order_items (
      order_id, product_id, product_name, quantity, unit_price, addons, notes,
      portion_stock_deducted
    ) VALUES (
      v_order_id,
      (v_line ->> 'product_id')::uuid,
      v_line ->> 'product_name',
      (v_line ->> 'quantity')::integer,
      (v_line ->> 'unit_price')::numeric,
      coalesce(v_line -> 'addons', '[]'::jsonb),
      v_line ->> 'notes',
      EXISTS (
        SELECT 1 FROM public.products p
         WHERE p.id = (v_line ->> 'product_id')::uuid AND p.stock IS NOT NULL
      )
    );
  END LOOP;

  RETURN jsonb_build_object(
    'id', v_order_id,
    'status', p_status,
    'total_amount', v_total,
    'order_number', v_order_number,
    'replayed', false
  );
END;
$function$;

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
  v_rec record;
  v_qty integer;
  v_after numeric(14,3);
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
    (v_current_status = 'pending' AND p_new_status IN ('preparing', 'cancelled'))
    OR (v_current_status = 'preparing' AND p_new_status IN ('ready', 'cancelled'))
    OR (v_current_status = 'ready' AND p_new_status IN ('delivered', 'cancelled'))
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

  IF p_new_status = 'cancelled' THEN
    -- Restore the original portion-based stock, if the merchant uses it.
    FOR v_rec IN
      SELECT oi.product_id, sum(oi.quantity)::integer AS quantity
        FROM public.order_items oi
       WHERE oi.order_id = p_order_id
         AND oi.product_id IS NOT NULL
         AND oi.portion_stock_deducted
       GROUP BY oi.product_id
       ORDER BY oi.product_id
    LOOP
      UPDATE public.products
         SET stock = stock + v_rec.quantity
       WHERE id = v_rec.product_id AND stock IS NOT NULL;
    END LOOP;

    -- Recipe quantities are taken from the immutable consume movements, not
    -- the current recipe, so editing a recipe after an order cannot over-credit.
    FOR v_rec IN
      SELECT ingredient_id, -quantity_delta AS quantity, unit
        FROM public.inventory_movements
       WHERE order_id = p_order_id AND movement_type = 'consume'
       ORDER BY ingredient_id
    LOOP
      UPDATE public.ingredients
         SET quantity_on_hand = quantity_on_hand + v_rec.quantity
       WHERE id = v_rec.ingredient_id
       RETURNING quantity_on_hand INTO v_after;

      INSERT INTO public.inventory_movements (
        project_id, ingredient_id, order_id, movement_type,
        quantity_delta, stock_after, unit, actor_user_id
      ) VALUES (
        v_project_id, v_rec.ingredient_id, p_order_id, 'restore',
        v_rec.quantity, v_after, v_rec.unit, v_caller
      );
    END LOOP;
  END IF;

  v_event := CASE WHEN p_new_status = 'cancelled' THEN 'cancelled' ELSE 'status_changed' END;
  INSERT INTO public.order_audit_logs (
    order_id, project_id, event, old_status, new_status, actor_user_id, metadata
  ) VALUES (
    p_order_id, v_project_id, v_event, v_current_status::text, p_new_status,
    v_caller, jsonb_build_object('source', 'advance_order_status')
  );

  RETURN jsonb_build_object(
    'id', p_order_id,
    'old_status', v_current_status,
    'status', p_new_status
  );
END
$$;

COMMENT ON FUNCTION public.create_order_transactional(
  uuid, text, text, numeric, integer, jsonb, uuid, text, uuid, uuid
) IS 'Creates an order, reprices options, and atomically consumes portion and recipe inventory. Duplicate client request IDs replay the original order.';

COMMENT ON TABLE public.inventory_movements IS
  'Immutable tenant-scoped audit ledger for ingredient receipts, adjustments, order consumption, and cancellation restoration.';
