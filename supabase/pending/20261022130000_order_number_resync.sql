-- Order numbering can get permanently stuck after any out-of-band order insert.
--
-- WHAT THIS CHANGES
--   public.next_order_number() only reads daily_order_counters. Any order row
--   inserted outside create_order_transactional (data import, a support fix, a
--   restore, or a seeding script) leaves that counter behind while the orders'
--   own numbers move on. The function then hands out a number that already
--   exists for the day, the insert fails on idx_orders_project_number_unique
--   (23505), and — because the counter increment is rolled back with the failed
--   insert — EVERY later attempt regenerates the same taken number. Ordering is
--   dead for that project for the rest of the day.
--
--   Reproduced on production with a throwaway tenant (2026-10-22): three rows
--   inserted directly (numbers 1,2,3), counter untouched → every order attempt
--   returned 500, and the API-side retry returned 503 «الخادم مشغول».
--
--   The counter is now monotonic with the day's real maximum:
--     next = greatest(counter, max(order_number) for the day) + 1
--
-- WHAT IT DOES NOT CHANGE
--   Signature, return type, SECURITY DEFINER, search_path, and the permission
--   check are byte-identical to the deployed definition. The ACL is preserved
--   by CREATE OR REPLACE (the function is service_role-only; see
--   phase12_function_grants.sql). No table, column, or index is touched.
--   The per-day boundary stays Asia/Bahrain, matching the unique index
--   expression exactly.
--
-- ROLLBACK
--   Re-create the previous body (a plain `counter = counter + 1` upsert):

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
  v_max integer;
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

  -- The highest number actually used today. Rows written outside the RPC are
  -- invisible to the counter, but never invisible to the unique index.
  select coalesce(max(o.order_number), 0)
    into v_max
    from public.orders o
   where o.project_id = p_project_id
     and (o.created_at at time zone 'Asia/Bahrain')::date
         = (now() at time zone 'Asia/Bahrain')::date;

  insert into public.daily_order_counters (project_id, date, counter)
  values (p_project_id, (now() at time zone 'Asia/Bahrain')::date, greatest(v_max, 0) + 1)
  on conflict (project_id, date)
  do update set counter = greatest(daily_order_counters.counter, excluded.counter - 1) + 1
  returning counter into v_next;

  return v_next;
end;
$function$;
