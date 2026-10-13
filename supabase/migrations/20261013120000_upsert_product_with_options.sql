-- ============================================================================
-- Product write path — ONE transactional RPC for the product + its option tree
-- ============================================================================
-- WHY (architecture review 2026-10-13, finding P0):
--   `product-form-modal.tsx` saved a product by hand from the browser: insert/
--   update the product, then delete every option_group, then re-insert each
--   group and its choices in a loop — up to ten separate round trips with NO
--   transaction. A failure in the middle (network, RLS, a constraint) left the
--   row it had already touched changed: delete succeeded + group insert failed
--   = a product with no options; product insert succeeded + option insert
--   failed = the customer sees a bare product. Nothing rolled any of it back.
--
--   Every other multi-step write in this product already goes through an RPC
--   (`create_order_transactional`, `replace_product_recipe`,
--   `onboard_project_transactional`). This migration brings the product editor
--   onto the same rule: one call, one transaction, all-or-nothing.
--
-- POSTURE: `security invoker`, NOT definer. The tables' own RLS policies already
--   allow exactly `owner`/`manager` to write `products`, `option_groups` and
--   `option_choices`, so an invoker function needs no new privilege and RLS
--   stays the boundary. The explicit `has_project_role(...)` guard below is
--   belt-and-braces: it produces a named error (`NOT_AUTHORIZED`) instead of a
--   silent zero-row update, and it makes the requirement readable here rather
--   than only inside a policy. `search_path` is pinned because this function
--   names tables directly.
-- ============================================================================

create or replace function public.upsert_product_with_options(
  p_project_id uuid,
  p_product_id uuid,                -- NULL = create, otherwise update-in-place
  p_name text,
  p_name_en text,
  p_description text,
  p_price numeric,
  p_category_id uuid,
  p_is_available boolean,
  p_image_url text,
  p_stock integer,                  -- NULL = untracked/unlimited (products.stock model)
  p_groups jsonb                    -- [{name, min_select, max_select, choices:[{name, price}]}]
)
returns jsonb
language plpgsql
security invoker
set search_path to 'public'
as $function$
declare
  v_product_id uuid;
  v_next_sort integer;
  v_group jsonb;
  v_choice jsonb;
  v_group_id uuid;
  v_gi integer := 0;
  v_ci integer;
  v_choice_count integer;
  v_result jsonb;
begin
  -- ── tenant guard ─────────────────────────────────────────────────────────
  -- Mirrors the products/option_* write policies. An invoker call from an
  -- unauthenticated session has auth.uid() = NULL, so has_project_role() is
  -- false and the call is refused (42501) — never silently ignored.
  if not public.has_project_role(p_project_id, array['owner', 'manager']) then
    raise exception 'NOT_AUTHORIZED' using errcode = '42501';
  end if;

  -- ── input validation ─────────────────────────────────────────────────────
  -- The form validates first (so the user sees a specific Arabic message), and
  -- these guards are the second line for a caller that skips the form.
  if coalesce(trim(p_name), '') = '' then
    raise exception 'NAME_REQUIRED' using errcode = 'P0001';
  end if;
  if p_price is null or p_price < 0 then
    raise exception 'INVALID_PRICE' using errcode = 'P0001';
  end if;
  if p_stock is not null and p_stock < 0 then
    raise exception 'INVALID_STOCK' using errcode = 'P0001';
  end if;

  if p_category_id is not null and not exists (
    select 1 from public.categories c
     where c.id = p_category_id and c.project_id = p_project_id
  ) then
    raise exception 'CATEGORY_NOT_FOUND' using errcode = 'P0001';
  end if;

  -- Every group must carry at least one variety. The form refuses this too,
  -- but an empty group renders as nothing on the menu, so it is rejected here
  -- rather than stored as dead weight (same rule as the form).
  for v_group in select value from jsonb_array_elements(coalesce(p_groups, '[]'::jsonb)) loop
    if coalesce(trim(v_group ->> 'name'), '') = '' then
      raise exception 'GROUP_NAME_REQUIRED' using errcode = 'P0001';
    end if;
    select count(*) into v_choice_count
      from jsonb_array_elements(coalesce(v_group -> 'choices', '[]'::jsonb)) c
     where coalesce(trim(c ->> 'name'), '') <> '';
    if v_choice_count = 0 then
      raise exception 'GROUP_NEEDS_CHOICE' using errcode = 'P0001';
    end if;
    for v_choice in select value from jsonb_array_elements(coalesce(v_group -> 'choices', '[]'::jsonb)) loop
      if coalesce(trim(v_choice ->> 'name'), '') = '' then
        raise exception 'CHOICE_NAME_REQUIRED' using errcode = 'P0001';
      end if;
      if coalesce((v_choice ->> 'price')::numeric, -1) < 0 then
        raise exception 'INVALID_CHOICE_PRICE' using errcode = 'P0001';
      end if;
    end loop;
  end loop;

  -- ── the product row ──────────────────────────────────────────────────────
  if p_product_id is null then
    -- Append at the end of the project's list, computed the same way the client
    -- used to (`max(sort_order) + 1`, or 0 for an empty menu).
    select coalesce(max(sort_order), -1) + 1 into v_next_sort
      from public.products
     where project_id = p_project_id;

    insert into public.products (
      project_id, name, name_en, description, price, category_id,
      is_available, image_url, sort_order, stock
    ) values (
      p_project_id,
      trim(p_name),
      nullif(trim(coalesce(p_name_en, '')), ''),
      nullif(trim(coalesce(p_description, '')), ''),
      p_price,
      p_category_id,
      coalesce(p_is_available, true),
      nullif(trim(coalesce(p_image_url, '')), ''),
      v_next_sort,
      p_stock
    )
    returning id into v_product_id;
  else
    update public.products
       set name = trim(p_name),
           name_en = nullif(trim(coalesce(p_name_en, '')), ''),
           description = nullif(trim(coalesce(p_description, '')), ''),
           price = p_price,
           category_id = p_category_id,
           is_available = coalesce(p_is_available, true),
           image_url = nullif(trim(coalesce(p_image_url, '')), ''),
           stock = p_stock
     where id = p_product_id
       and project_id = p_project_id
    returning id into v_product_id;

    -- A wrong project (or a row RLS hides) matches nothing: report it as a
    -- missing product instead of returning a success the UI would trust.
    if v_product_id is null then
      raise exception 'PRODUCT_NOT_FOUND' using errcode = 'P0001';
    end if;
  end if;

  -- ── the option tree ──────────────────────────────────────────────────────
  -- Wholesale replace, not a diff — same reasoning as the code it replaces:
  -- the tree is tiny, deleting a group cascades to its varieties, and no
  -- durable row references a choice id (an order line keeps a name+price
  -- SNAPSHOT in `order_items.addons`), so a diff would buy nothing.
  delete from public.option_groups where product_id = v_product_id;

  for v_group in select value from jsonb_array_elements(coalesce(p_groups, '[]'::jsonb)) loop
    insert into public.option_groups (product_id, name, min_select, max_select, sort_order)
    values (
      v_product_id,
      trim(v_group ->> 'name'),
      coalesce((v_group ->> 'min_select')::integer, 0),
      coalesce((v_group ->> 'max_select')::integer, 1),
      v_gi
    )
    returning id into v_group_id;

    v_ci := 0;
    for v_choice in select value from jsonb_array_elements(coalesce(v_group -> 'choices', '[]'::jsonb)) loop
      insert into public.option_choices (group_id, name, price, is_available, sort_order)
      values (
        v_group_id,
        trim(v_choice ->> 'name'),
        coalesce((v_choice ->> 'price')::numeric, 0),
        coalesce((v_choice ->> 'is_available')::boolean, true),
        v_ci
      );
      v_ci := v_ci + 1;
    end loop;

    v_gi := v_gi + 1;
  end loop;

  -- ── return the saved product WITH its tree ───────────────────────────────
  -- The caller used to re-select this with a nested `option_groups(*,
  -- option_choices(*))` after saving (one more round trip, and a second chance
  -- to read a half-written tree). Returning it from inside the transaction
  -- means the payload the UI renders is the row that was actually committed.
  select to_jsonb(p) || jsonb_build_object(
           'option_groups', coalesce((
             select jsonb_agg(
                      jsonb_build_object(
                        'id', g.id,
                        'product_id', g.product_id,
                        'name', g.name,
                        'name_en', g.name_en,
                        'min_select', g.min_select,
                        'max_select', g.max_select,
                        'sort_order', g.sort_order,
                        'created_at', g.created_at,
                        'option_choices', coalesce((
                          select jsonb_agg(
                                   jsonb_build_object(
                                     'id', c.id,
                                     'group_id', c.group_id,
                                     'name', c.name,
                                     'name_en', c.name_en,
                                     'price', c.price,
                                     'is_available', c.is_available,
                                     'sort_order', c.sort_order,
                                     'created_at', c.created_at
                                   ) order by c.sort_order, c.name
                                 )
                            from public.option_choices c
                           where c.group_id = g.id
                        ), '[]'::jsonb)
                      ) order by g.sort_order, g.name
                    )
               from public.option_groups g
              where g.product_id = p.id
           ), '[]'::jsonb)
         )
    into v_result
    from public.products p
   where p.id = v_product_id;

  return v_result;
end;
$function$;

comment on function public.upsert_product_with_options(
  uuid, uuid, text, text, text, numeric, uuid, boolean, text, integer, jsonb
) is
  'Product create-or-update + wholesale option-tree replace in ONE transaction (review 2026-10-13, P0). security invoker — RLS still gates owner/manager; explicit has_project_role guard returns NOT_AUTHORIZED instead of a silent no-op.';

-- Grants: exactly the surfaces that could already write these tables directly.
-- `anon` gets NOTHING (it has no write policy on any of the three tables), and
-- PUBLIC is revoked because Postgres grants EXECUTE to PUBLIC by default.
revoke all on function public.upsert_product_with_options(
  uuid, uuid, text, text, text, numeric, uuid, boolean, text, integer, jsonb
) from public, anon;

grant execute on function public.upsert_product_with_options(
  uuid, uuid, text, text, text, numeric, uuid, boolean, text, integer, jsonb
) to authenticated, service_role;
