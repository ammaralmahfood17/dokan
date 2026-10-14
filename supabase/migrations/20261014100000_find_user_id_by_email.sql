-- ============================================================================
-- find_user_id_by_email — one indexed lookup instead of a 1000-row scan
-- ============================================================================
-- WHY (architecture review 2026-10-13, P2): `/api/super-admin/create-project`
-- resolved the owner by calling `admin.auth.admin.listUsers({ page: 1,
-- perPage: 1000 })` and `.find()`-ing the email in JavaScript. That is one
-- Auth-server round trip that serialises up to a thousand users, every time a
-- super-admin creates a store — and the Admin API has no "get user by email".
--
-- The lookup itself is trivially indexed (auth.users has had `idx_users_email`
-- since the auth schema was created), so the honest fix is a tiny
-- service_role-only function. It is NOT exposed to `authenticated`: a merchant
-- must never be able to enumerate other merchants' emails.
--
-- POSTURE: SECURITY DEFINER with a pinned `search_path` (it reads `auth.users`,
-- which the caller cannot), EXECUTE revoked from PUBLIC/anon/authenticated and
-- granted to `service_role` alone — the same shape as `next_order_number`.
-- ============================================================================

create or replace function public.find_user_id_by_email(p_email text)
returns uuid
language sql
stable
security definer
set search_path to 'public'
as $function$
  select u.id
    from auth.users u
   where lower(u.email) = lower(trim(p_email))
     -- A soft-deleted account must not be handed a project: the row is still in
     -- auth.users, but the user cannot sign in to it.
     and u.deleted_at is null
   order by u.created_at, u.id
   limit 1;
$function$;

comment on function public.find_user_id_by_email(text) is
  'Resolve one user id by email (case-insensitive, soft-deleted excluded). service_role ONLY: a merchant must not be able to enumerate emails. Replaces the 1000-row auth.admin.listUsers scan in /api/super-admin/create-project.';

revoke all on function public.find_user_id_by_email(text) from public, anon, authenticated;
grant execute on function public.find_user_id_by_email(text) to service_role;
