import { redirect } from 'next/navigation';
import { createClient } from '@/lib/supabase/server';
import { createAdminClient } from '@/lib/supabase/admin';
import { createClient as createSupabaseClient } from '@supabase/supabase-js';
import type { Json } from '@/lib/database.types';
import { getSiteUrl } from '@/lib/site-url';
import { getJwtExpiryMs } from '@/lib/jwt';
import { getPublicSupabaseConfig } from '@/lib/env/public';

/**
 * Super-admin surface helpers (server-only).
 *
 * SECURITY MODEL:
 * - Every page/route in /super-admin re-checks membership via
 *   `is_super_admin()` (SECURITY DEFINER RPC reading super_admins by
 *   auth.uid()) at request time — never trusts a session that was valid
 *   when a page loaded.
 * - The audit helper writes via service_role (the table is service_role-only;
 *   anon/authenticated have no grants). Every super-admin WRITE action must
 *   call `logSuperAdminAction` — a missing audit row is treated as a bug.
 */

/** httpOnly marker cookie set by /api/super-admin/impersonate and read by
 *  the dashboard layout + end route. Never exposed to page JS (2026-09-20
 *  hardening: the value alone must not authorize ending a session). */
export const MARKER_COOKIE = 'dokan-impersonation';
/** Non-secret browser hint used only to disable automatic token refresh. */
export const SUPPORT_MODE_COOKIE = 'dokan-support-mode';

/** Shape of the session objects we mint and store server-side ourselves. */
export type StoredSession = {
  access_token: string;
  refresh_token: string;
  expires_in?: number;
  token_type?: string;
};

export type SuperAdminAction =
  | 'subscription.renew'
  | 'subscription.record_payment'
  | 'project.deactivate'
  | 'project.create'
  | 'project.archive'
  | 'project.hard_delete'
  | 'impersonation.start'
  | 'impersonation.end'
  | 'audit.view'
  // Amendment A5 (owner decision 3): manually confirming an account whose confirmation mail
  // cannot be delivered yet (SMTP pending).
  | 'user.confirm';

/** Returns the current user id if they are a super admin, else null. */
export async function getSuperAdminUserId(): Promise<string | null> {
  const supabase = await createClient();
  const {
    data: { user },
  } = await supabase.auth.getUser();
  if (!user) return null;

  const { data: isAdmin } = await supabase.rpc('is_super_admin');
  return isAdmin ? user.id : null;
}

/** Gate a server component / route handler. Redirects to /login if not admin. */
export async function requireSuperAdmin(): Promise<string> {
  const adminUserId = await getSuperAdminUserId();
  if (!adminUserId) redirect('/login');
  return adminUserId;
}

/** Write an audit entry (service_role — bypasses RLS on the log table). */
export async function logSuperAdminAction(input: {
  actorUserId: string;
  action: SuperAdminAction;
  targetProjectId?: string | null;
  targetUserId?: string | null;
  metadata?: Record<string, unknown>;
}): Promise<void> {
  const admin = createAdminClient();
  const { error } = await admin.from('super_admin_audit_log').insert({
    actor_user_id: input.actorUserId,
    action: input.action,
    target_project_id: input.targetProjectId ?? null,
    target_user_id: input.targetUserId ?? null,
    metadata: (input.metadata ?? {}) as unknown as Json,
  });
  if (error) {
    // Logging must never silently fail — surface it loudly.
    console.error('[SuperAdmin] audit log insert failed:', error.message);
    throw new Error(`audit log failed: ${error.message}`);
  }
}

// ===========================================================================
// Phase C — impersonation ("login as" for support)
//
// HOW IT WORKS (investigated against the real Supabase admin API before
// building — see the live probe):
//   admin.generateLink({type:'magiclink'}) + verifyOtp(token_hash) mints a
//   short-lived session for the target user with NO password exposure. The
//   real target refresh token is revoked before any response is sent; the
//   browser receives only the access token plus a deliberately unusable local
//   placeholder. Supabase Auth must therefore be configured with a JWT expiry
//   of at most 30 minutes, which is checked at runtime and fails closed.
//
// LIMITATION (reported explicitly): this requires the target user to not
// have MFA / TOTP enabled — verifyOtp with a magiclink token_hash bypasses
// password but not MFA. If a target has MFA on, the impersonation will fail
// at verifyOtp. Flagged, not silently handled.
// ===========================================================================

const IMPERSONATION_TTL_MS = 30 * 60 * 1000; // hard 30-minute limit
const IMPERSONATION_TTL_TOLERANCE_MS = 5_000;

export type ImpersonationSession = {
  id: string;
  targetUserId: string;
  targetProjectId: string | null;
  targetEmail: string;
  expiresAt: string;
  expired: boolean;
};

/** Mint a session for the target and store both sessions (service_role). */
export async function startImpersonation(input: {
  actorUserId: string;
  actorSession: Json; // the super admin's CURRENT session — restored on end
  targetUserId: string;
  targetProjectId: string | null;
}): Promise<{
  sessionId: string;
  targetSession: { access_token: string; refresh_token: string };
  expiresAt: string;
}> {
  const admin = createAdminClient();

  const { data: targetUser } = await admin.auth.admin.getUserById(input.targetUserId);
  if (!targetUser?.user?.email) throw new Error('target user not found');
  const targetEmail = targetUser.user.email;

  if (input.targetProjectId) {
    const { data: ownerMembership } = await admin
      .from('staff_members')
      .select('id')
      .eq('project_id', input.targetProjectId)
      .eq('user_id', input.targetUserId)
      .eq('role', 'owner')
      .maybeSingle();
    if (!ownerMembership) throw new Error('target is not the project owner');
  }

  // 1. Mint the owner session (no password involved).
  const { data: link, error: linkErr } = await admin.auth.admin.generateLink({
    type: 'magiclink',
    email: targetEmail,
    options: { redirectTo: `${getSiteUrl()}/dashboard` },
  });
  if (linkErr || !link?.properties?.hashed_token) {
    throw new Error(`generateLink failed: ${linkErr?.message ?? 'no token'}`);
  }

  const { url: supabaseUrl, anonKey } = getPublicSupabaseConfig();
  const verifier = createSupabaseClient(
    supabaseUrl,
    anonKey,
    { auth: { persistSession: false, autoRefreshToken: false } }
  );
  const { data: verified, error: verifyErr } = await verifier.auth.verifyOtp({
    type: 'magiclink',
    token_hash: link.properties.hashed_token,
  });
  if (verifyErr || !verified.session) {
    throw new Error(`verifyOtp failed: ${verifyErr?.message ?? 'no session'} (target may have MFA enabled)`);
  }

  const tokenExpiresAt = getJwtExpiryMs(verified.session.access_token);
  const tokenLifetime = tokenExpiresAt - Date.now();
  if (tokenLifetime > IMPERSONATION_TTL_MS + IMPERSONATION_TTL_TOLERANCE_MS) {
    await admin.auth.admin.signOut(verified.session.access_token, 'local');
    throw new Error('SUPABASE_JWT_EXPIRY_TOO_LONG');
  }
  if (tokenLifetime <= 0) throw new Error('target access token already expired');

  // Revoke the real refresh token before the access token leaves this process.
  // Supabase access JWTs remain valid until exp, but this session can never be
  // extended beyond that cryptographic deadline.
  const { error: revokeError } = await admin.auth.admin.signOut(
    verified.session.access_token,
    'local'
  );
  if (revokeError) throw new Error(`target refresh revocation failed: ${revokeError.message}`);

  // Persist the admin session for restoration. The target JSON intentionally
  // contains no refresh token; the DB constraint enforces that invariant.
  const expiresAt = new Date(Math.min(Date.now() + IMPERSONATION_TTL_MS, tokenExpiresAt)).toISOString();
  const { data: row, error: insErr } = await admin
    .from('impersonation_sessions')
    .insert({
      super_admin_user_id: input.actorUserId,
      target_user_id: input.targetUserId,
      target_project_id: input.targetProjectId,
      super_admin_session: input.actorSession,
      target_session: { access_token: verified.session.access_token },
      expires_at: expiresAt,
    })
    .select('id')
    .single();
  if (insErr || !row) throw new Error(`impersonation persist failed: ${insErr?.message}`);

  return {
    sessionId: row.id,
    targetSession: {
      access_token: verified.session.access_token,
      // setSession requires a non-empty value. It is never sent to GoTrue
      // because the access token is still valid, and auto-refresh is disabled
      // while the support-mode cookie exists.
      refresh_token: `non-refreshable-${row.id}`,
    },
    expiresAt,
  };
}

/** Look up the active impersonation row by marker cookie id. */
export async function getImpersonationById(
  sessionId: string
): Promise<ImpersonationSession | null> {
  if (!sessionId) return null;
  const admin = createAdminClient();
  const { data } = await admin
    .from('impersonation_sessions')
    .select('id, target_user_id, target_project_id, expires_at, ended_at')
    .eq('id', sessionId)
    .maybeSingle();
  if (!data || data.ended_at) return null;
  const expired = new Date(data.expires_at as string).getTime() <= Date.now();

  const { data: targetUser } = await admin.auth.admin.getUserById(data.target_user_id as string);
  return {
    id: data.id as string,
    targetUserId: data.target_user_id as string,
    targetProjectId: data.target_project_id as string | null,
    targetEmail: targetUser?.user?.email ?? 'unknown',
    expiresAt: data.expires_at as string,
    expired,
  };
}

/** End an impersonation: mark ended and return the stored sessions for
 *  cookie restoration (service_role). */
export async function endImpersonation(sessionId: string): Promise<{
  superAdminSession: Json | null;
  superAdminUserId: string;
  targetProjectId: string | null;
  targetUserId: string;
} | null> {
  const admin = createAdminClient();
  const { data: row } = await admin
    .from('impersonation_sessions')
    .select('id, super_admin_session, super_admin_user_id, target_project_id, target_user_id, ended_at')
    .eq('id', sessionId)
    .maybeSingle();
  if (!row || row.ended_at) return null;

  const { error: updateError } = await admin
    .from('impersonation_sessions')
    .update({
      ended_at: new Date().toISOString(),
      super_admin_session: {},
      target_session: {},
    })
    .eq('id', sessionId);
  if (updateError) throw new Error(`impersonation end failed: ${updateError.message}`);
  return {
    superAdminSession: (row.super_admin_session as Json | null) ?? null,
    superAdminUserId: row.super_admin_user_id as string,
    targetProjectId: row.target_project_id as string | null,
    targetUserId: row.target_user_id as string,
  };
}
