-- Migration: an account can only be created by the app's own provisioning path
-- (backend audit B-1, 2026-10-16)
--
-- THE FINDING, MEASURED: the owner closed signups (SIGNUP_ENABLED, plus no Turnstile keys, so
-- /api/auth/signup answers 503). That gate lives in ONE Next route. Supabase's own endpoint is a
-- second door, reachable with the public anon key that ships in every browser bundle:
--
--   POST {SUPABASE_URL}/auth/v1/signup  {"email":"not-an-email","password":"x"}
--     -> HTTP 422 {"error_code":"weak_password","msg":"Password should be at least 6 characters."}
--
-- The `weak_password` shape is emitted only by GoTrue's signup handler, which proves the endpoint
-- parses and validates the request — i.e. it will create an account for a well-formed body, with a
-- 6-character minimum instead of this product's policy, no CAPTCHA, and no regard for
-- SIGNUP_ENABLED. (The payload above creates nothing; it was chosen to be invalid for exactly
-- that reason. The creation itself is inferred from the response shape, not performed.)
--
-- THE FIX, and why it is a trigger rather than a setting: turning signup off in the Supabase
-- dashboard is the first answer, but this repo's own rule is that a boundary must hold at the data
-- layer and be asserted, not configured in a console nobody versions. So: a BEFORE INSERT trigger
-- on auth.users that requires the marker only the app's own path can set.
--
--   * The app calls `admin.auth.admin.createUser({ app_metadata: { provisioned_by: 'dokan-admin-api' } })`.
--   * GoTrue's /signup maps a client's `data` field to **user_metadata**, never to app_metadata, so
--     a direct caller cannot forge the marker.
--
-- CONSEQUENCE, stated because it is real: an account created by hand in the Supabase dashboard
-- (or by any future path that does not set the marker) is REJECTED. That is the intended
-- enforcement; the workaround is to create the user through the app's route, or to run
--   insert into auth.users (...) with raw_app_meta_data = '{"provisioned_by":"dokan-admin-api"}'
-- from the SQL editor, or to drop this trigger deliberately.
--
-- Rollback:
--   drop trigger if exists auth_users_require_api_provisioning on auth.users;
--   drop function if exists public.auth_users_require_api_provisioning();

create or replace function public.auth_users_require_api_provisioning()
returns trigger
language plpgsql
security definer
set search_path to 'public'
as $$
begin
  -- An account must carry the marker the app's provisioning route sets. `->>'...'` is NULL when
  -- the key is absent, so a direct GoTrue signup (or a dashboard insert) lands here and is refused.
  if coalesce(new.raw_app_meta_data ->> 'provisioned_by', '') <> 'dokan-admin-api' then
    raise exception 'account creation is closed: use the app signup flow'
      using errcode = '42501';
  end if;
  return new;
end;
$$;

drop trigger if exists auth_users_require_api_provisioning on auth.users;
create trigger auth_users_require_api_provisioning
  before insert on auth.users
  for each row execute function public.auth_users_require_api_provisioning();

-- The function is a trigger body, never a callable endpoint.
revoke all on function public.auth_users_require_api_provisioning() from public, anon, authenticated;
