ALTER TABLE public.subscription_payments
  ADD COLUMN IF NOT EXISTS client_request_id uuid;

COMMENT ON COLUMN public.subscription_payments.client_request_id IS
  'Idempotency key of the operator action that recorded this payment (audit T2 #11). Unique per project; NULL for historical rows.';

CREATE UNIQUE INDEX IF NOT EXISTS subscription_payments_client_request_key
  ON public.subscription_payments (project_id, client_request_id)
  WHERE client_request_id IS NOT NULL;
DROP FUNCTION IF EXISTS public.record_payment_and_renew(uuid, numeric, text, text, text, integer, uuid);

CREATE OR REPLACE FUNCTION public.record_payment_and_renew(
  p_project_id uuid,
  p_amount numeric,
  p_method text,
  p_receipt text DEFAULT NULL::text,
  p_notes text DEFAULT NULL::text,
  p_days integer DEFAULT 30,
  p_caller_id uuid DEFAULT NULL::uuid,
  p_client_request_id uuid DEFAULT NULL::uuid
)
 RETURNS timestamp with time zone
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO 'public'
AS $function$
DECLARE
  v_caller      uuid;
  v_expiry      timestamptz;
  v_project_name text;
  v_project_slug text;
BEGIN
  v_caller := coalesce(p_caller_id, auth.uid());
  IF v_caller IS NULL OR auth.role() <> 'service_role' THEN
    RAISE EXCEPTION 'forbidden: service_role only' USING ERRCODE = '42501';
  END IF;

  SELECT name, slug
    INTO v_project_name, v_project_slug
    FROM public.projects
   WHERE id = p_project_id
   FOR UPDATE;

  IF v_project_name IS NULL THEN
    RAISE EXCEPTION 'project not found' USING ERRCODE = 'P0002';
  END IF;

  -- ── replay guard (audit T2 #11) ─────────────────────────────────────────────
  -- A double-submitted payment form used to record TWO payment rows and extend the
  -- subscription TWICE (60 days for one payment). With a key, the second call answers with the
  -- expiry as it already stands and does not extend again.
  IF p_client_request_id IS NOT NULL
     AND EXISTS (
       SELECT 1 FROM public.subscription_payments
        WHERE project_id = p_project_id
          AND client_request_id = p_client_request_id
     ) THEN
    SELECT subscription_expires_at INTO v_expiry
      FROM public.projects
     WHERE id = p_project_id;
    RETURN v_expiry;
  END IF;

  INSERT INTO public.subscription_payments (
    project_id,
    project_name_snapshot,
    project_slug_snapshot,
    amount,
    currency,
    method,
    receipt,
    recorded_by,
    notes,
    client_request_id
  ) VALUES (
    p_project_id,
    v_project_name,
    v_project_slug,
    p_amount,
    'BHD',
    p_method,
    p_receipt,
    v_caller,
    p_notes,
    p_client_request_id
  );

  UPDATE public.projects
     SET subscription_expires_at = greatest(coalesce(subscription_expires_at, now()), now())
                                     + make_interval(days => p_days),
         is_active = true,
         deleted_at = NULL
   WHERE id = p_project_id
   RETURNING subscription_expires_at INTO v_expiry;

  RETURN v_expiry;
END
$function$;
-- PUBLIC matters: EXECUTE is granted to PUBLIC by default on a NEW function, so dropping and
-- re-creating silently handed authenticated users the ability to run this RPC. Mirrors
-- 20260928090000_phase1_critical_security.sql:104, which is why the live ACL had no PUBLIC entry.
REVOKE ALL ON FUNCTION public.record_payment_and_renew(uuid, numeric, text, text, text, integer, uuid, uuid) FROM PUBLIC, anon, authenticated;
GRANT EXECUTE ON FUNCTION public.record_payment_and_renew(uuid, numeric, text, text, text, integer, uuid, uuid) TO service_role;

DO $$
BEGIN
  IF has_function_privilege('authenticated', 'public.record_payment_and_renew(uuid, numeric, text, text, text, integer, uuid, uuid)', 'EXECUTE') THEN
    RAISE EXCEPTION 'assertion failed: authenticated can still execute record_payment_and_renew';
  END IF;
  IF NOT has_function_privilege('service_role', 'public.record_payment_and_renew(uuid, numeric, text, text, text, integer, uuid, uuid)', 'EXECUTE') THEN
    RAISE EXCEPTION 'assertion failed: service_role lost EXECUTE on record_payment_and_renew';
  END IF;
  IF EXISTS (
    SELECT 1 FROM pg_proc
     WHERE proname = 'record_payment_and_renew'
       AND pg_get_function_identity_arguments(oid) = 'uuid, numeric, text, text, text, integer, uuid'
  ) THEN
    RAISE EXCEPTION 'assertion failed: the old 7-arg overload still exists';
  END IF;
END $$;
