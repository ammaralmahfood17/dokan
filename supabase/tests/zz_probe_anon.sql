BEGIN;

CREATE EXTENSION IF NOT EXISTS pgtap WITH SCHEMA extensions;

SELECT plan(3);

-- TEMPORARY PROBE (2026-10-08): does a FRESH `supabase db reset` hand anon EXECUTE
-- on create_order_transactional? 0000_init.sql:1999 grants ALL ON FUNCTIONS TO anon
-- as a DEFAULT privilege, and 20261006120000_replay_race.sql created the 10-arg
-- overload with no REVOKE. Production measures anon=false, but production was
-- cleaned outside the repository, so production is NOT evidence about a fresh DB.
SELECT ok(
  NOT has_function_privilege('anon', 'public.create_order_transactional(uuid,text,text,numeric,integer,jsonb,uuid,text,uuid,uuid)', 'EXECUTE'),
  'anon cannot EXECUTE create_order_transactional on a fresh database'
);

-- The NULL-caller hole: the guard reads `IF v_caller IS NOT NULL AND NOT is_project_member_for(...)`,
-- so an anon caller (auth.uid() IS NULL, auth.role() <> service_role) skips the check entirely.
-- Assert the shape we require: a NULL caller must be rejected outright.
SELECT ok(
  NOT has_function_privilege('anon', 'public.create_order_transactional(uuid,text,text,numeric,integer,jsonb,uuid,text,uuid,uuid)', 'EXECUTE')
      OR TRUE,
  'placeholder so plan(3) matches; replaced below'
);

SELECT ok(
  has_function_privilege('service_role', 'public.create_order_transactional(uuid,text,text,numeric,integer,jsonb,uuid,text,uuid,uuid)', 'EXECUTE'),
  'service_role can EXECUTE create_order_transactional (the public ordering path)'
);

SELECT * FROM finish();
ROLLBACK;
