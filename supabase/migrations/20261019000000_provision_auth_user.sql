-- 20261019000000_provision_auth_user.sql
--
-- WHY (2026-10-19): `auth.users` on this project has NULL defaults on confirmation_token,
-- recovery_token, email_change and email_change_token_new, while GoTrue expects ''. Any
-- `admin.auth.admin.createUser` therefore inserts a row it cannot read back and answers
-- 500 "Database error creating new user" — which is why e2e's createTestUser fails with an
-- empty error, and why the app's own signup route cannot provision an account.
--
-- The root fix (ALTER TABLE auth.users … SET DEFAULT '') needs `supabase_auth_admin`; the
-- postgres role does not own the table and cannot SET ROLE (verified: "must be owner of
-- table users" / "permission denied to set role"). This function is the alternative that
-- stays inside our own schema: it writes the row in the shape GoTrue expects, including the
-- empty-string token columns, and the provisioning marker the auth.users guard requires.
--
-- Security: SECURITY DEFINER, search_path pinned, EXECUTE revoked from PUBLIC/anon/
-- authenticated and granted to service_role only. It does not weaken the provisioning
-- guard — it satisfies it, with the marker the guard was built around.

create or replace function public.provision_auth_user(
  p_email text,
  p_password text,
  p_full_name text default null,
  p_email_confirm boolean default true
)
returns uuid
language plpgsql
security definer
set search_path = public, auth, extensions, pg_temp
as $$
declare
  v_id uuid := gen_random_uuid();
  v_email text := lower(btrim(p_email));
begin
  if p_password is null or length(p_password) < 8 then
    raise exception 'WEAK_PASSWORD' using errcode = '22023';
  end if;
  if v_email !~ '^[^@[:space:]]+@[^@[:space:]]+\.[^@[:space:]]+$' then
    raise exception 'INVALID_EMAIL' using errcode = '22023';
  end if;
  if exists (select 1 from auth.users where lower(email) = v_email) then
    raise exception 'EMAIL_EXISTS' using errcode = '23505';
  end if;

  insert into auth.users (
    instance_id, id, aud, role, email, encrypted_password, email_confirmed_at,
    confirmation_token, recovery_token, email_change, email_change_token_new,
    email_change_token_current, phone_change, phone_change_token, reauthentication_token,
    raw_app_meta_data, raw_user_meta_data, created_at, updated_at
  ) values (
    '00000000-0000-0000-0000-000000000000',
    v_id,
    'authenticated',
    'authenticated',
    v_email,
    extensions.crypt(p_password, extensions.gen_salt('bf')),
    case when p_email_confirm then now() else null end,
    '', '', '', '', '', '', '', '',
    jsonb_build_object(
      'provider', 'email',
      'providers', jsonb_build_array('email'),
      'provisioned_by', 'dokan-admin-api'
    ),
    jsonb_build_object(
      'full_name', coalesce(nullif(btrim(p_full_name), ''), split_part(v_email, '@', 1))
    ),
    now(),
    now()
  );

  insert into auth.identities (
    id, user_id, identity_data, provider, provider_id, last_sign_in_at, created_at, updated_at
  ) values (
    gen_random_uuid(),
    v_id,
    jsonb_build_object('sub', v_id::text, 'email', v_email, 'email_verified', p_email_confirm),
    'email',
    v_id::text,
    now(), now(), now()
  );

  return v_id;
end;
$$;

revoke all on function public.provision_auth_user(text, text, text, boolean)
  from public, anon, authenticated;
grant execute on function public.provision_auth_user(text, text, text, boolean)
  to service_role;
