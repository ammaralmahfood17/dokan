-- ============================================================================
-- 0017_order_integrity.sql
--
-- Two real correctness defects, both closed at the DB layer (the only layer
-- that can make them atomic):
--
-- (A) TOCTOU on price / availability — the oversell hole.
--     The app read products + addons, computed the cart total in JS, then
--     called create_order_transactional with the prices IT had computed. Two
--     RPC round-trips (~200-400ms) sat between that read and the INSERT, so a
--     merchant edit in the window was silently accepted: the order was written
--     at the stale price, and an item that had just been marked
--     غير متوفر was still sold. create_order_transactional now recomputes
--     EVERY line from live product/addon rows inside the same transaction and
--     takes the total from that recomputation — the caller's prices, names,
--     addon list and total are advisory only. An item/addon that is gone or
--     unavailable is REJECTED (clean 409) instead of sold. Rows are locked
--     FOR SHARE in a deterministic (product_id-sorted) order so a concurrent
--     merchant edit serialises against the order instead of racing it, and two
--     simultaneous carts cannot deadlock each other.
--
-- (B) Order-number business day — the 3-hour slice.
--     The daily counter keyed on current_date (UTC) while the analytics bucket
--     orders by Asia/Bahrain (UTC+3), and the uniqueness index keyed on the UTC
--     date of created_at. In a Bahrain late-night service that is a real,
--     visible bug: a business day spanning UTC midnight can contain TWO orders
--     numbered #1 (the UTC counter resets at 03:00 local). Both the counter and
--     the index now key on the Asia/Bahrain business day, matching analytics.
--     The number is also allocated by the BEFORE INSERT trigger inside the
--     SAME transaction as the row (the app no longer pre-allocates it in a
--     separate transaction), so the counter's day and created_at's day come
--     from one transaction timestamp (now() is transaction-fixed) and can never
--     disagree — the midnight-straddle race is gone by construction, and a
--     failed create no longer burns a counter slot.
--
-- Note on scope: this closes the TOCTOU/oversell correctness hole. A numeric
-- per-product stock counter (limit "only 5 portions") is a separate merchant
-- feature, not a bug fix — it needs product-form UI, a sold-out rule and a
-- cancel-restock path, and is deliberately NOT half-built here.
-- ============================================================================

-- ---------------------------------------------------------------------------
-- (B1) Daily counter keys on the merchant's business day (Asia/Bahrain).
--      now() is transaction_timestamp(), so when the trigger calls this inside
--      the order INSERT the day is computed from the very same instant that
--      becomes created_at.
-- ---------------------------------------------------------------------------
create or replace function public.next_order_number(
  p_project_id uuid,
  p_caller_user_id uuid default null::uuid
)
returns integer
language plpgsql
security definer
set search_path to 'public'
as $function$
declare
  v_next integer;
  v_caller uuid;
begin
  v_caller := auth.uid();
  -- 0005: p_caller_user_id is honored ONLY for genuine service_role
  -- backend calls — never inferred when the request is anon.
  if v_caller is null and auth.role() = 'service_role' then
    v_caller := p_caller_user_id;
  end if;
  if v_caller is not null and not public.is_project_member_for(v_caller, p_project_id) then
    raise exception 'not authorized for this project' using errcode = '42501';
  end if;

  insert into public.daily_order_counters (project_id, date, counter)
  values (p_project_id, (now() at time zone 'Asia/Bahrain')::date, 1)
  on conflict (project_id, date)
  do update set counter = daily_order_counters.counter + 1
  returning counter into v_next;

  return v_next;
end;
$function$;

-- ---------------------------------------------------------------------------
-- (B2) Uniqueness index keys on the same business day.
--      Fail loudly (with the offending rows) if the change would collide,
--      rather than letting CREATE INDEX raise an opaque error on live data.
-- ---------------------------------------------------------------------------
do $$
declare
  v_bad text;
begin
  select string_agg(format('project %s / %s / #%s (%s rows)', project_id, d, order_number, n), '; ')
    into v_bad
    from (
      select project_id, (created_at at time zone 'Asia/Bahrain')::date as d, order_number, count(*) as n
        from public.orders
       where service_type is null
       group by 1, 2, 3
      having count(*) > 1
    ) x;
  if v_bad is not null then
    raise exception 'cannot re-key order-number uniqueness to Asia/Bahrain — existing collisions: %', v_bad;
  end if;
end $$;

drop index if exists public.idx_orders_project_number_unique;

create unique index idx_orders_project_number_unique
  on public.orders (project_id, ((created_at at time zone 'Asia/Bahrain')::date), order_number)
  where service_type is null;

-- ---------------------------------------------------------------------------
-- (A) create_order_transactional — authoritative repricing + availability
--     re-check inside the transaction.
--     Signature is UNCHANGED (grants/ACL preserved by CREATE OR REPLACE);
--     p_total_amount / the per-item unit_price are now advisory inputs.
--     order_number is always allocated by the trg_orders_auto_number trigger
--     (we insert 0 to arm it) so the number and the row share one timestamp.
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
  -- 0005: p_caller_user_id is honored ONLY for genuine service_role
  -- backend calls — never inferred when the request is anon.
  if v_caller is null and auth.role() = 'service_role' then
    v_caller := p_caller_user_id;
  end if;
  if v_caller is not null and not public.is_project_member_for(v_caller, p_project_id) then
    raise exception 'not authorized for this project' using errcode = '42501';
  end if;

  -- ── replay guard (unchanged) ───────────────────────────────────────────
  -- Runs AFTER the tenant guard on purpose: authorization must be settled
  -- before we reveal that a key already exists, otherwise the response
  -- becomes an oracle for "did someone else's checkout use this key".
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

  -- ── (A) authoritative repricing pass ───────────────────────────────────
  -- Iterate in product_id order so the FOR SHARE locks are always taken in
  -- the same sequence by every concurrent cart (no lock-cycle deadlocks);
  -- carry the cart position so the stored lines keep the customer's order.
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

    -- Lock the row so a merchant edit either commits before this order or
    -- waits for it — never interleaves. Values read here are the committed
    -- ones for the rest of this transaction.
    select p.price, p.is_available, p.project_id, p.name
      into v_prod_price, v_prod_avail, v_prod_project, v_prod_name
      from public.products p
     where p.id = v_prod_id
       for share;

    if not found or v_prod_project is distinct from p_project_id then
      raise exception 'PRODUCT_NOT_FOUND' using errcode = 'P0001';
    end if;
    if not v_prod_avail then
      raise exception 'ITEM_UNAVAILABLE: %', v_prod_name using errcode = 'P0001';
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
-- Retire the legacy 9-argument overload.
-- CREATE OR REPLACE only rewrites the signature it is given, so the pre-0014
-- 9-arg object kept its OLD body — i.e. an un-repriced create path that is
-- EXECUTE-able to service_role as a separate object. (Postgres keys GRANT /
-- REVOKE / DROP by identity arguments; the overload is a different function.)
-- The app always sends all ten named arguments (src/lib/order-pricing.ts passes
-- p_client_request_id explicitly, null included), so PostgREST resolves to the
-- 10-arg form and this one is dead code.
-- ---------------------------------------------------------------------------
drop function if exists public.create_order_transactional(
  uuid, text, text, numeric, integer, jsonb, uuid, text, uuid
);
