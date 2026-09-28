-- Phase 4/5 production hardening: resolve actionable Security Advisor findings.

-- Trigger functions run through their triggers and must never be callable as
-- public RPC endpoints. PostgreSQL grants EXECUTE to PUBLIC by default.
REVOKE ALL ON FUNCTION public.order_items_validate_project()
  FROM PUBLIC, anon, authenticated;
REVOKE ALL ON FUNCTION public.orders_auto_number()
  FROM PUBLIC, anon, authenticated;
REVOKE ALL ON FUNCTION public.orders_validate_amount_on_insert()
  FROM PUBLIC, anon, authenticated;

GRANT EXECUTE ON FUNCTION public.order_items_validate_project() TO service_role;
GRANT EXECUTE ON FUNCTION public.orders_auto_number() TO service_role;
GRANT EXECUTE ON FUNCTION public.orders_validate_amount_on_insert() TO service_role;

-- The retention function is invoker-security but still needs an immutable
-- object resolution path when cron executes it.
ALTER FUNCTION public.purge_web_vitals() SET search_path = public;

DO $$
DECLARE
  v_function text;
BEGIN
  FOREACH v_function IN ARRAY ARRAY[
    'public.order_items_validate_project()',
    'public.orders_auto_number()',
    'public.orders_validate_amount_on_insert()'
  ]
  LOOP
    IF has_function_privilege('anon', v_function, 'EXECUTE')
       OR has_function_privilege('authenticated', v_function, 'EXECUTE') THEN
      RAISE EXCEPTION 'security assertion failed: web role can execute %', v_function;
    END IF;
  END LOOP;

  IF NOT EXISTS (
    SELECT 1
      FROM pg_proc p
      JOIN pg_namespace n ON n.oid = p.pronamespace
     WHERE n.nspname = 'public'
       AND p.proname = 'purge_web_vitals'
       AND p.proconfig @> ARRAY['search_path=public']
  ) THEN
    RAISE EXCEPTION 'security assertion failed: purge_web_vitals search_path is mutable';
  END IF;
END
$$;
