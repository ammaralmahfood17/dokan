-- Product options: a product can carry MANY option groups («خيارات»), and each
-- group holds its own varieties («أنواع») with their own price.
--
-- Owner decision 2026-10-06 (replacing the flat one-level addon list):
--   * every variety has its OWN price (0 allowed),
--   * each group declares single-or-multi and required-or-optional
--     (min_select / max_select), and
--   * the flat `product_addons` feature is DELETED — options only.
--     Production held ZERO product_addons rows when this ran (checked), so the
--     DROP loses nothing; there is nothing to migrate.
--
-- Storage note: `order_items.addons` keeps its name and its jsonb shape
-- ([{id,name,price}]) — it is the snapshot of the chosen varieties on a line.
-- Renaming it would ripple through the cart, the KDS, the offline queue in
-- public/sw.js and the POS for no behavioural gain, so the COLUMN stays and
-- only its source of truth changed (option_choices instead of product_addons).

-- ---------------------------------------------------------------------------
-- 1. Tables
-- ---------------------------------------------------------------------------
create table if not exists public.option_groups (
  id uuid primary key default gen_random_uuid(),
  product_id uuid not null references public.products(id) on delete cascade,
  name text not null,
  name_en text,
  -- 0 = optional, >=1 = the customer must pick that many. max_select = 1 makes
  -- the group single-choice (radios); anything higher allows a multi-selection.
  min_select integer not null default 0,
  max_select integer not null default 1,
  sort_order integer not null default 0,
  created_at timestamptz not null default now(),
  constraint option_groups_min_check check (min_select >= 0),
  constraint option_groups_max_check check (max_select >= 1),
  constraint option_groups_range_check check (min_select <= max_select)
);

create table if not exists public.option_choices (
  id uuid primary key default gen_random_uuid(),
  group_id uuid not null references public.option_groups(id) on delete cascade,
  name text not null,
  name_en text,
  price numeric(10,3) not null default 0,
  is_available boolean not null default true,
  sort_order integer not null default 0,
  created_at timestamptz not null default now(),
  constraint option_choices_price_check check (price >= 0)
);

create index if not exists idx_option_groups_product
  on public.option_groups(product_id);
create index if not exists idx_option_choices_group
  on public.option_choices(group_id);
create index if not exists idx_option_choices_group_available
  on public.option_choices(group_id, is_available);

-- ---------------------------------------------------------------------------
-- 2. Row level security — same shape as the addon policies it replaces
-- ---------------------------------------------------------------------------
alter table public.option_groups enable row level security;
alter table public.option_choices enable row level security;

-- Staff of the owning project read everything (available or not).
create policy option_groups_member_read on public.option_groups
  for select to authenticated
  using (exists (
    select 1 from public.products p
     where p.id = option_groups.product_id and public.is_project_member(p.project_id)
  ));

-- The public menu (anon) only sees groups of a live store.
create policy option_groups_public_read on public.option_groups
  for select to anon
  using (exists (
    select 1 from public.products p
      join public.projects pr on pr.id = p.project_id
     where p.id = option_groups.product_id and pr.is_active = true
  ));

create policy option_groups_write on public.option_groups
  for all to authenticated
  using (exists (
    select 1 from public.products p
     where p.id = option_groups.product_id
       and public.has_project_role(p.project_id, array['owner','manager'])
  ))
  with check (exists (
    select 1 from public.products p
     where p.id = option_groups.product_id
       and public.has_project_role(p.project_id, array['owner','manager'])
  ));

create policy option_choices_member_read on public.option_choices
  for select to authenticated
  using (exists (
    select 1 from public.option_groups g
      join public.products p on p.id = g.product_id
     where g.id = option_choices.group_id and public.is_project_member(p.project_id)
  ));

-- Anon sees only the varieties a customer may actually order.
create policy option_choices_public_read on public.option_choices
  for select to anon
  using (
    is_available = true
    and exists (
      select 1 from public.option_groups g
        join public.products p on p.id = g.product_id
        join public.projects pr on pr.id = p.project_id
       where g.id = option_choices.group_id and pr.is_active = true
    )
  );

create policy option_choices_write on public.option_choices
  for all to authenticated
  using (exists (
    select 1 from public.option_groups g
      join public.products p on p.id = g.product_id
     where g.id = option_choices.group_id
       and public.has_project_role(p.project_id, array['owner','manager'])
  ))
  with check (exists (
    select 1 from public.option_groups g
      join public.products p on p.id = g.product_id
     where g.id = option_choices.group_id
       and public.has_project_role(p.project_id, array['owner','manager'])
  ));

-- ---------------------------------------------------------------------------
-- 3. Grants — mirror product_addons exactly (anon may read, staff may write)
-- ---------------------------------------------------------------------------
grant select on table public.option_groups to anon;
grant select, insert, update, delete on table public.option_groups to authenticated;
grant select, insert, update, delete on table public.option_groups to service_role;

grant select on table public.option_choices to anon;
grant select, insert, update, delete on table public.option_choices to authenticated;
grant select, insert, update, delete on table public.option_choices to service_role;

-- ---------------------------------------------------------------------------
-- 4. The flat addon list is retired
-- ---------------------------------------------------------------------------
-- NOT dropped here, on purpose. The currently deployed build still selects
-- `product_addons(*)` when rendering the public menu, so dropping the table in
-- this migration would 500 every QR scan for the minutes between this migration
-- and the code deploy. The table is left EMPTY and unread (nothing writes it any
-- more); `20261006200000_drop_legacy_addons.sql` drops it once the new build is
-- live and verified. It held ZERO rows, so nothing is lost either way.
comment on table public.product_addons is
  'RETIRED 2026-10-06 — replaced by option_groups/option_choices. Empty; dropped by 20261006200000 once the new build is live.';

-- ---------------------------------------------------------------------------
-- 5. Authoritative repricing now validates OPTION CHOICES and their group rules
-- ---------------------------------------------------------------------------
-- Everything else in this function is unchanged from migration 0017; the option
-- block replaces the addon block one-for-one. The JSON key stays `addons` (see
-- the storage note at the top), so the request contract is byte-identical.
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
  v_option_ids uuid[];
  v_option_found integer;
  v_option_total numeric;
  v_options_json jsonb;
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

    -- ── options ──────────────────────────────────────────────────────────
    -- Every requested choice must belong to a group of THIS product and be
    -- available. Round each price before summing — that is exactly what
    -- src/lib/order-pricing.ts does with money(), so the two agree.
    v_option_ids := array(
      select (e ->> 'id')::uuid
        from jsonb_array_elements(coalesce(v_rec.item -> 'addons', '[]'::jsonb)) e
       where coalesce(e ->> 'id', '') ~ '^[0-9a-fA-F-]{36}$'
    );

    if v_option_ids is null or array_length(v_option_ids, 1) is null then
      v_option_total := 0;
      v_options_json := '[]'::jsonb;
    else
      -- A duplicate id collapses in this count and fails the equality below —
      -- duplicates are rejected rather than silently priced twice.
      select coalesce(sum(round(c.price, v_dec)), 0), count(*)
        into v_option_total, v_option_found
        from public.option_choices c
        join public.option_groups g on g.id = c.group_id
       where c.id = any(v_option_ids)
         and g.product_id = v_prod_id
         and c.is_available;

      if v_option_found <> array_length(v_option_ids, 1) then
        raise exception 'OPTION_UNAVAILABLE' using errcode = 'P0001';
      end if;

      -- Group rules, enforced SERVER-side: a group the customer skipped must not
      -- be required, and no group may be over-selected. The bounds are clamped
      -- to the group's AVAILABLE choices, so a group whose varieties are all
      -- sold out can never brick checkout — it simply stops being required, and
      -- the menu (which only renders available choices) agrees with this rule.
      if exists (
        select 1
          from public.option_groups g
          join public.option_choices c on c.group_id = g.id and c.is_available
         where g.product_id = v_prod_id
         group by g.id, g.min_select, g.max_select
        having count(*) filter (where c.id = any(v_option_ids)) < least(g.min_select, count(*))
            or count(*) filter (where c.id = any(v_option_ids)) > greatest(1, least(g.max_select, count(*)))
      ) then
        raise exception 'OPTION_SELECTION_INVALID' using errcode = 'P0001';
      end if;

      select coalesce(
               jsonb_agg(
                 jsonb_build_object('id', c.id, 'name', c.name, 'price', round(c.price, v_dec))
                 order by u.ord
               ),
               '[]'::jsonb
             )
        into v_options_json
        from unnest(v_option_ids) with ordinality as u(cid, ord)
        join public.option_choices c on c.id = u.cid;
    end if;

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
  end loop;

  v_total := round(v_total, v_dec);

  insert into public.orders (
    project_id, table_id, type, status, total_amount, notes, order_number, client_request_id
  )
  values (
    p_project_id, p_table_id, p_type::order_type, p_status::order_status,
    v_total, left(p_notes, 500), 0, p_client_request_id
  )
  returning id, order_number into v_order_id, v_order_number;

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