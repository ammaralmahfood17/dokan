-- 20261006120000_replay_race.sql
--
-- Audit 2026-10-05 (Task 2, finding #12): two concurrent requests carrying the SAME
-- idempotency key both passed the sequential replay guard, the partial unique index on
-- (project_id, client_request_id) rejected the second INSERT, and the loser surfaced as a 500
-- to a customer whose order had in fact been created. The customer sees an error and re-orders.
--
-- This is a CREATE OR REPLACE of public.create_order_transactional with the body copied
-- VERBATIM from 0018_product_stock.sql (the live definition was dumped from production and
-- diffed) plus ONE added exception handler around the orders INSERT. The signature is
-- unchanged, so ACLs are preserved.
--
-- ROLLBACK: re-apply the previous body verbatim (CREATE OR REPLACE takes it back):
--   supabase/migrations/0018_product_stock.sql  (the create_order_transactional definition)

CREATE OR REPLACE FUNCTION public.create_order_transactional(p_project_id uuid, p_type text, p_status text, p_total_amount numeric, p_order_number integer, p_items jsonb, p_table_id uuid DEFAULT NULL::uuid, p_notes text DEFAULT NULL::text, p_caller_user_id uuid DEFAULT NULL::uuid, p_client_request_id uuid DEFAULT NULL::uuid)
 RETURNS jsonb
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO 'public'
AS $function$
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
  begin
    insert into public.orders (
      project_id, table_id, type, status, total_amount, notes, order_number, client_request_id
    )
    values (
      p_project_id, p_table_id, p_type::order_type, p_status::order_status,
      v_total, left(p_notes, 500), 0, p_client_request_id
    )
    returning id, order_number into v_order_id, v_order_number;
  exception when unique_violation then
    -- Concurrent retry with the same idempotency key (audit T2 #12). The 0014 guard above only
    -- covers SEQUENTIAL retries: when two requests with one key arrive together, both pass it,
    -- the partial unique index rejects the loser, and the loser used to surface as a 500 to a
    -- customer whose order HAD been created. Return the winner's order instead.
    select * into v_existing
      from public.orders
     where project_id = p_project_id
       and client_request_id = p_client_request_id;
    if not found then raise; end if;
    return jsonb_build_object(
      'id', v_existing.id,
      'status', v_existing.status,
      'total_amount', v_existing.total_amount,
      'order_number', v_existing.order_number,
      'replayed', true
    );
  end;

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

COMMENT ON FUNCTION public.create_order_transactional(uuid, text, text, numeric, integer, jsonb, uuid, text, uuid, uuid) IS
  'Transactional order creation. Since audit T2 #12 (2026-10-06) a concurrent duplicate with the same client_request_id returns the EXISTING order instead of raising 23505.';
