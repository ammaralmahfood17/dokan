-- Phase 1 critical security: destructive project operations, financial
-- retention, onboarding RPC grants, and legacy impersonation secrets.

-- ---------------------------------------------------------------------------
-- 1. A tenant owner must never be able to delete the tenant row directly.
-- ---------------------------------------------------------------------------
DROP POLICY IF EXISTS projects_delete_owner ON public.projects;
REVOKE DELETE ON TABLE public.projects FROM anon, authenticated;

-- ---------------------------------------------------------------------------
-- 2. Financial history survives project deletion.  The snapshots keep a
-- useful audit record after project_id is nulled by the foreign key.
-- ---------------------------------------------------------------------------
ALTER TABLE public.subscription_payments
  ADD COLUMN IF NOT EXISTS project_name_snapshot text,
  ADD COLUMN IF NOT EXISTS project_slug_snapshot text;

UPDATE public.subscription_payments AS payment
   SET project_name_snapshot = project.name,
       project_slug_snapshot = project.slug
  FROM public.projects AS project
 WHERE payment.project_id = project.id
   AND (payment.project_name_snapshot IS NULL OR payment.project_slug_snapshot IS NULL);

ALTER TABLE public.subscription_payments
  ALTER COLUMN project_name_snapshot SET NOT NULL,
  ALTER COLUMN project_slug_snapshot SET NOT NULL,
  ALTER COLUMN project_id DROP NOT NULL,
  DROP CONSTRAINT IF EXISTS subscription_payments_project_id_fkey,
  ADD CONSTRAINT subscription_payments_project_id_fkey
    FOREIGN KEY (project_id) REFERENCES public.projects(id) ON DELETE SET NULL;

-- Keep future snapshots authoritative at write time, inside the same payment
-- transaction.  The service role is still the only executable caller.
CREATE OR REPLACE FUNCTION public.record_payment_and_renew(
  p_project_id   uuid,
  p_amount       numeric,
  p_method       text,
  p_receipt      text DEFAULT NULL,
  p_notes        text DEFAULT NULL,
  p_days         int  DEFAULT 30,
  p_caller_id    uuid DEFAULT NULL
)
RETURNS timestamptz
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
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

  INSERT INTO public.subscription_payments (
    project_id,
    project_name_snapshot,
    project_slug_snapshot,
    amount,
    currency,
    method,
    receipt,
    recorded_by,
    notes
  ) VALUES (
    p_project_id,
    v_project_name,
    v_project_slug,
    p_amount,
    'BHD',
    p_method,
    p_receipt,
    v_caller,
    p_notes
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
$$;

REVOKE ALL ON FUNCTION public.record_payment_and_renew(uuid, numeric, text, text, text, int, uuid)
  FROM PUBLIC, anon, authenticated;
GRANT EXECUTE ON FUNCTION public.record_payment_and_renew(uuid, numeric, text, text, text, int, uuid)
  TO service_role;

-- ---------------------------------------------------------------------------
-- 3. Hard deletion is allowed only after 30 days in the archive.  Validation,
-- audit logging, and deletion are one transaction, so a successful delete can
-- never exist without its audit event.
-- ---------------------------------------------------------------------------
DROP FUNCTION IF EXISTS public.super_admin_hard_delete_project(uuid, uuid);

CREATE FUNCTION public.super_admin_hard_delete_project(
  p_project_id uuid,
  p_confirm_name text,
  p_reason text,
  p_caller_user_id uuid DEFAULT NULL
)
RETURNS boolean
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  v_caller uuid;
  v_project public.projects%ROWTYPE;
BEGIN
  v_caller := auth.uid();
  IF v_caller IS NULL AND auth.role() = 'service_role' THEN
    v_caller := p_caller_user_id;
  END IF;

  IF v_caller IS NULL THEN
    RAISE EXCEPTION 'not authenticated' USING ERRCODE = '42501';
  END IF;

  IF NOT EXISTS (
    SELECT 1 FROM public.super_admins WHERE user_id = v_caller
  ) THEN
    RAISE EXCEPTION 'super admin only' USING ERRCODE = '42501';
  END IF;

  IF length(trim(coalesce(p_reason, ''))) < 10 THEN
    RAISE EXCEPTION 'deletion reason must be at least 10 characters'
      USING ERRCODE = '22023';
  END IF;

  SELECT * INTO v_project
    FROM public.projects
   WHERE id = p_project_id
   FOR UPDATE;

  IF NOT FOUND THEN
    RAISE EXCEPTION 'project not found' USING ERRCODE = 'P0002';
  END IF;

  IF trim(coalesce(p_confirm_name, '')) <> v_project.name THEN
    RAISE EXCEPTION 'project name confirmation does not match'
      USING ERRCODE = '22023';
  END IF;

  IF v_project.deleted_at IS NULL THEN
    RAISE EXCEPTION 'project must be archived before permanent deletion'
      USING ERRCODE = '55000';
  END IF;

  IF v_project.deleted_at > now() - interval '30 days' THEN
    RAISE EXCEPTION 'project must remain archived for 30 days before permanent deletion'
      USING ERRCODE = '55000';
  END IF;

  INSERT INTO public.super_admin_audit_log (
    actor_user_id,
    action,
    target_project_id,
    metadata
  ) VALUES (
    v_caller,
    'project.hard_delete',
    p_project_id,
    jsonb_build_object(
      'projectName', v_project.name,
      'slug', v_project.slug,
      'reason', trim(p_reason),
      'archivedAt', v_project.deleted_at
    )
  );

  DELETE FROM public.projects WHERE id = p_project_id;
  RETURN true;
END
$$;

REVOKE ALL ON FUNCTION public.super_admin_hard_delete_project(uuid, text, text, uuid)
  FROM PUBLIC, anon, authenticated;
GRANT EXECUTE ON FUNCTION public.super_admin_hard_delete_project(uuid, text, text, uuid)
  TO service_role;

-- ---------------------------------------------------------------------------
-- 4. Function EXECUTE defaults include PUBLIC.  Revoke the effective grant,
-- not only the anon/authenticated role grants.
-- ---------------------------------------------------------------------------
REVOKE ALL ON FUNCTION public.onboard_project_transactional(text, text, text, text, uuid)
  FROM PUBLIC, anon, authenticated;
GRANT EXECUTE ON FUNCTION public.onboard_project_transactional(text, text, text, text, uuid)
  TO service_role;

-- ---------------------------------------------------------------------------
-- 5. Invalidate legacy impersonation sessions and remove retained target
-- refresh tokens. New application code stores only a short-lived access token.
-- ---------------------------------------------------------------------------
UPDATE public.impersonation_sessions
   SET ended_at = coalesce(ended_at, now()),
       super_admin_session = '{}'::jsonb,
       target_session = '{}'::jsonb;

ALTER TABLE public.impersonation_sessions
  DROP CONSTRAINT IF EXISTS impersonation_target_session_no_refresh,
  ADD CONSTRAINT impersonation_target_session_no_refresh
    CHECK (NOT (target_session ? 'refresh_token')),
  DROP CONSTRAINT IF EXISTS impersonation_max_duration,
  ADD CONSTRAINT impersonation_max_duration
    CHECK (expires_at <= created_at + interval '30 minutes 5 seconds');

COMMENT ON TABLE public.impersonation_sessions IS
  'Service-role-only support sessions. Target refresh tokens are forbidden; access is capped by both JWT exp and expires_at.';

-- ---------------------------------------------------------------------------
-- 6. Deployment assertions. A drifted or partially-applied schema must fail
-- here rather than shipping with destructive privileges still available.
-- ---------------------------------------------------------------------------
DO $$
BEGIN
  IF has_table_privilege('anon', 'public.projects', 'DELETE')
     OR has_table_privilege('authenticated', 'public.projects', 'DELETE') THEN
    RAISE EXCEPTION 'security assertion failed: web roles can delete projects';
  END IF;

  IF EXISTS (
    SELECT 1
      FROM pg_policies
     WHERE schemaname = 'public'
       AND tablename = 'projects'
       AND policyname = 'projects_delete_owner'
  ) THEN
    RAISE EXCEPTION 'security assertion failed: projects_delete_owner still exists';
  END IF;

  IF has_function_privilege(
    'anon',
    'public.onboard_project_transactional(text,text,text,text,uuid)',
    'EXECUTE'
  ) OR has_function_privilege(
    'authenticated',
    'public.onboard_project_transactional(text,text,text,text,uuid)',
    'EXECUTE'
  ) THEN
    RAISE EXCEPTION 'security assertion failed: onboarding RPC exposed to web roles';
  END IF;

  IF NOT EXISTS (
    SELECT 1
      FROM pg_constraint
     WHERE conname = 'subscription_payments_project_id_fkey'
       AND confdeltype = 'n'
  ) THEN
    RAISE EXCEPTION 'security assertion failed: payment history is not ON DELETE SET NULL';
  END IF;
END
$$;
