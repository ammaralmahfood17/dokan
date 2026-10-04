-- ============================================================================
-- 0018_product_stock.sql
--
-- Per-product stock ("عدد الحصص") — the feature that turns the oversell fix
-- into something a merchant can actually operate.
--
-- Model
--   products.stock integer NULL  → NULL = UNTRACKED (unlimited; today's
--   behaviour for every existing product, so this migration changes nothing
--   for them). A number = that many portions remain today.
--
-- Semantics
--   * stock = 0  → the item shows as «غير متوفر» on the public menu and in the
--     POS, exactly like is_available=false. It is NOT auto-hidden (0011 keeps
--     sold-out items visible, greyed) and it does NOT touch is_available: the
--     merchant's manual switch stays theirs.
--   * Ordering decrements the stock ATOMICALLY inside the same transaction that
--     inserts the order (create_order_transactional). Insufficient stock is
--     rejected — the customer never buys a portion that is not there. The rows
--     are locked FOR UPDATE in product_id order, so concurrent carts serialise
--     on the same product instead of racing, and cannot deadlock each other.
--   * Cancelling an order returns its portions to stock (advance_order_status),
--     in product_id order for the same reason. Only tracked products (stock IS
--     NOT NULL) are touched — an untracked product must never become tracked by
--     accident.
--   * A failed create rolls back the decrement with the rest of the
--     transaction, so no portion is ever burned by an error.
--
-- Grants: no change needed. `anon`/`authenticated`/`service_role` all hold
-- TABLE-level SELECT/INSERT/UPDATE on products (verified live), and a table
-- grant covers columns added later. Do NOT start hand-managing column grants
-- here — the two layers are independent and that is exactly the trap that has
-- bitten this schema before (a column REVOKE does not undo a table GRANT and
-- vice versa).
-- ============================================================================

alter table public.products
  add column if not exists stock integer;

alter table public.products
  drop constraint if exists products_stock_nonneg;

alter table public.products
  add constraint products_stock_nonneg check (stock is null or stock >= 0);

comment on column public.products.stock is
  'NULL = untracked/unlimited. Otherwise portions remaining; 0 renders as sold out. Decremented atomically by create_order_transactional, restored by advance_order_status on cancel.';

-- ---------------------------------------------------------------------------
-- create_order_transactional — stock-aware. Supersedes the 0017 body: the
-- product lock is now FOR UPDATE (an exclusive lock, because we mutate the
-- row) instead of FOR SHARE, and each tracked line decrements it.
-- ---------------------------------------------------------------------------
create or replace function public.create_order_transactional(
  p_project_id uuid,
  p_type text,
  p_status text,
  p_total_amount numeric,
  p_order_number integer,
  p_items jsonb,
  p_table_id uuid default null::uuid,
  p_notes text default null::text,
  p_caller_user_id uuid default null::uuid,
  p_client_request_id uuid default null::uuid
)
returns jsonb
language plpgsql
security definer
set search_path to 'public'
as $function$
declare
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
  v_addon_ids uuid[];
  v_addon_found integer;
  v_addon_total numeric;
  v_addons_json jsonb;
  v_unit numeric;
  v_total numeric := 0;
  v_lines jsonb := '[]'::jsonb;
  v_line jsonb;
begin
  -- ── tenant guard (unchanged) ───────────────────────────────────────────
  v_caller := auth.uid();
  if v_caller is null and auth.role() = 'service_role' then
    v_caller := p_caller_user_id;
  end if;
  if v_caller is not null and not public.is_project_member_for(v_caller, p_project_id) then
    raise exception 'not authorized for this project' using errcode = '42501';
  end if;

  -- ── replay guard (unchanged) ───────────────────────────────────────────
  if p_client_request_id is not null then
    select * into v_existing
      from public.orders
     where project_id = p_project_id
       and client_request_id = p_client_request_id;

    if found then
      return jsonb_build_object(
        'id', v_existing.id,
        'status', v_existing.status,
        'total_amount', v_existing.total_amount,
        'order_number', v_existing.order_number,
        'replayed', true
      );
    end if;
  end if;

  -- ── currency-aware decimals (mirrors CURRENCY_DECIMALS in src/lib/utils.ts)
  select case when upper(coalesce(currency, '')) in ('BHD', 'KWD', 'OMR') then 3 else 2 end
    into v_dec
    from public.projects
   where id = p_project_id;
  if v_dec is null then
    raise exception 'PROJECT_NOT_FOUND' using errcode = 'P0001';
  end if;

  if p_items is null or jsonb_typeof(p_items) <> 'array' or jsonb_array_length(p_items) = 0 then
    raise exception 'EMPTY_CART' using errcode = 'P0001';
  end if;

  -- ── authoritative repricing + stock pass ───────────────────────────────
  -- product_id order so every concurrent cart takes the FOR UPDATE locks in
  -- the same sequence (no lock-cycle deadlocks); the cart position is carried
  -- so the stored lines keep the customer's order.
  for v_rec in
    select e.value as item, e.ord
      from jsonb_array_elements(p_items) with ordinality as e(value, ord)
     order by e.value ->> 'product_id'
  loop
    if coalesce(v_rec.item ->> 'product_id', '') !~ '^[0-9a-fA-F-]{36}$' then
      raise exception 'INVALID_LINE' using errcode = 'P0001';
    end if;
    v_prod_id := (v_rec.item ->> 'product_id')::uuid;

    if coalesce(v_rec.item ->> 'quantity', '') !~ '^[0-9]{1,3}$' then
      raise exception 'INVALID_LINE' using errcode = 'P0001';
    end if;
    v_qty := (v_rec.item ->> 'quantity')::integer;
    if v_qty <= 0 or v_qty > 99 then
      raise exception 'INVALID_LINE' using errcode = 'P0001';
    end if;

    -- FOR UPDATE (not FOR SHARE): we mutate stock below. A merchant edit or a
    -- second cart either commits before this order or waits for it — never
    -- interleaves.
    select p.price, p.is_available, p.project_id, p.name, p.stock
      into v_prod_price, v_prod_avail, v_prod_project, v_prod_name, v_prod_stock
      from public.products p
     where p.id = v_prod_id
       for update;

    if not found or v_prod_project is distinct from p_project_id then
      raise exception 'PRODUCT_NOT_FOUND' using errcode = 'P0001';
    end if;
    if not v_prod_avail then
      raise exception 'ITEM_UNAVAILABLE: %', v_prod_name using errcode = 'P0001';
    end if;

    -- Tracked product: never sell a portion that is not there. NULL = untracked.
    if v_prod_stock is not null then
      if v_prod_stock < v_qty then
        raise exception 'OUT_OF_STOCK: % (باقي %)', v_prod_name, v_prod_stock
          using errcode = 'P0001';
      end if;
      update public.products set stock = stock - v_qty where id = v_prod_id;
    end if;

    -- Addons: every requested id must exist, belong to THIS product and be
    -- available. Round each price before summing — that is exactly what
    -- src/lib/order-pricing.ts does with money(), so the two agree.
    v_addon_ids := array(
      select (e ->> 'id')::uuid
        from jsonb_array_elements(coalesce(v_rec.item -> 'addons', '[]'::jsonb)) e
       where coalesce(e ->> 'id', '') ~ '^[0-9a-fA-F-]{36}$'
    );

    if v_addon_ids is null or array_length(v_addon_ids, 1) is null then
      v_addon_total := 0;
      v_addons_json := '[]'::jsonb;
    else
      select coalesce(sum(round(a.price, v_dec)), 0), count(*)
        into v_addon_total, v_addon_found
        from public.product_addons a
       where a.id = any(v_addon_ids)
         and a.product_id = v_prod_id
         and a.is_available;

      if v_addon_found <> array_length(v_addon_ids, 1) then
        raise exception 'ADDON_UNAVAILABLE' using errcode = 'P0001';
      end if;

      select coalesce(
               jsonb_agg(
                 jsonb_build_object('id', a.id, 'name', a.name, 'price', round(a.price, v_dec))
                 order by u.ord
               ),
               '[]'::jsonb
             )
        into v_addons_json
        from unnest(v_addon_ids) with ordinality as u(aid, ord)
        join public.product_addons a on a.id = u.aid;
    end if;

    v_unit := round(v_prod_price + v_addon_total, v_dec);
    v_total := v_total + round(v_unit * v_qty, v_dec);

    v_lines := v_lines || jsonb_build_object(
      'ord', v_rec.ord,
      'product_id', v_prod_id,
      'product_name', v_prod_name,
      'quantity', v_qty,
      'unit_price', v_unit,
      'addons', v_addons_json,
      'notes', nullif(left(coalesce(v_rec.item ->> 'notes', ''), 200), '')
    );
  end loop;

  v_total := round(v_total, v_dec);

  -- order_number 0 arms trg_orders_auto_number, which allocates inside THIS
  -- transaction (so the counter day == created_at day, always).
  insert into public.orders (
    project_id, table_id, type, status, total_amount, notes, order_number, client_request_id
  )
  values (
    p_project_id, p_table_id, p_type::order_type, p_status::order_status,
    v_total, left(p_notes, 500), 0, p_client_request_id
  )
  returning id, order_number into v_order_id, v_order_number;

  -- Insert lines in the customer's original cart order.
  for v_line in
    select value from jsonb_array_elements(v_lines) order by (value ->> 'ord')::integer
  loop
    insert into public.order_items (
      order_id, product_id, product_name, quantity, unit_price, addons, notes
    )
    values (
      v_order_id,
      (v_line ->> 'product_id')::uuid,
      v_line ->> 'product_name',
      (v_line ->> 'quantity')::integer,
      (v_line ->> 'unit_price')::numeric,
      coalesce(v_line -> 'addons', '[]'::jsonb),
      v_line ->> 'notes'
    );
  end loop;

  return jsonb_build_object(
    'id', v_order_id,
    'status', p_status,
    'total_amount', v_total,
    'order_number', v_order_number,
    'replayed', false
  );
end;
$function$;

-- ---------------------------------------------------------------------------
-- advance_order_status — return the portions when an order is cancelled.
-- Only the cancel transition restocks, and the state machine makes 'cancelled'
-- terminal, so a cancel can never restock twice.
-- ---------------------------------------------------------------------------
create or replace function public.advance_order_status(
  p_order_id uuid,
  p_expected_status text,
  p_new_status text,
  p_caller_user_id uuid default null::uuid
)
returns jsonb
language plpgsql
security definer
set search_path to 'public'
as $function$
DECLARE
  v_project_id uuid;
  v_current_status public.order_status;
  v_caller uuid;
  v_event text;
  v_pid uuid;
  v_qty integer;
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

  -- Cancelling gives the portions back. Looped in product_id order so two
  -- concurrent cancels touching the same products cannot deadlock, and so a
  -- product appearing on two lines is credited twice. Untracked products
  -- (stock IS NULL) are left alone.
  IF p_new_status = 'cancelled' THEN
    FOR v_pid, v_qty IN
      SELECT oi.product_id, oi.quantity
        FROM public.order_items oi
       WHERE oi.order_id = p_order_id
         AND oi.product_id IS NOT NULL
       ORDER BY oi.product_id
    LOOP
      UPDATE public.products
         SET stock = stock + v_qty
       WHERE id = v_pid
         AND stock IS NOT NULL;
    END LOOP;
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
$function$;

-- Redefining a function with a different argument list would leave the old
-- object behind (see 0017); assert exactly one of each here.
do $$
declare v_n integer;
begin
  select count(*) into v_n
    from pg_proc p join pg_namespace n on n.oid = p.pronamespace
   where n.nspname = 'public' and p.proname = 'create_order_transactional';
  if v_n <> 1 then
    raise exception '0018: expected 1 create_order_transactional, found %', v_n;
  end if;
  select count(*) into v_n
    from pg_proc p join pg_namespace n on n.oid = p.pronamespace
   where n.nspname = 'public' and p.proname = 'advance_order_status';
  if v_n <> 1 then
    raise exception '0018: expected 1 advance_order_status, found %', v_n;
  end if;
end $$;
