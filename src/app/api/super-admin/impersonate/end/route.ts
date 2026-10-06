import { NextRequest, NextResponse } from 'next/server';
import * as Sentry from '@sentry/nextjs';
import { createClient } from '@/lib/supabase/server';
import {
  endImpersonation,
  logSuperAdminAction,
  MARKER_COOKIE,
  SUPPORT_MODE_COOKIE,
  type StoredSession,
} from '@/lib/super-admin';

/**
 * POST /api/super-admin/impersonate/end
 *
 * Ends the impersonation for THIS browser — proven by the httpOnly
 * dokan-impersonation marker cookie set at start (2026-09-20 hardening:
 * previously any caller who knew the sessionId could terminate the session
 * AND receive the super admin's live tokens in the response body; the
 * marker is now the sole credential and is invisible to page JS).
 *
 * The admin's own session is restored SERVER-SIDE (setSession writes the
 * auth cookies on this response) — super admin tokens are never returned in
 * a body again. Marks the row ended and writes an audit end entry. The
 * The caller's current auth cookies (the TARGET's session) are never signed out
 * here — that would log the store owner out of their own devices.
 *
 * NO RATE LIMIT HERE, unlike its seven sibling super-admin routes (audit
 * 2026-09-26). Those are token-authenticated and keyed on the admin's user id;
 * this one is bound to a single browser by the httpOnly marker cookie, so the
 * credential IS the throttle — a caller can only ever act on the one
 * impersonation their own browser started, and the id is dead once used. An IP
 * or per-user budget would add a failure mode (a legitimate admin whose retry
 * storm 429s and cannot restore their session) without closing any exposure.
 */
export async function POST(request: NextRequest) {
  try {
    const marker = request.cookies.get(MARKER_COOKIE)?.value;
    if (!marker || marker.length !== 36) {
      return NextResponse.json({ error: 'غير مصرح' }, { status: 401 });
    }

    const result = await endImpersonation(marker);
    let restored = false;

    if (result) {
      // Restore the super admin's own session server-side. (StoredSession
      // type = the tokens we minted ourselves at start; the Json column type
      // is too wide for tsc here.)
      const adminSession = result.superAdminSession as unknown as StoredSession | null;
      if (adminSession) {
        try {
          const userClient = await createClient();
          // W6-T3 (A8 option A): the stored session is an ACCESS TOKEN ONLY - a refreshable
          // credential for a super admin must not sit at rest. `setSession` still wants a
          // refresh_token value, so it gets the same non-refreshable placeholder the target side
          // uses: it is never sent to GoTrue while the access token is valid, and auto-refresh is
          // off in support mode. The admin's own browser cookie remains the real session; if the
          // access token has expired by the time they end support mode, they re-login.
          const { error } = await userClient.auth.setSession({
            access_token: adminSession.access_token,
            refresh_token: `non-refreshable-${marker}`,
          });
          restored = !error;
        } catch {
          restored = false; // expired access token — admin must re-login
        }
      }

      await logSuperAdminAction({
        actorUserId: result.superAdminUserId,
        action: 'impersonation.end',
        targetProjectId: result.targetProjectId,
        targetUserId: result.targetUserId,
        metadata: { sessionId: marker, restored },
      });
    }

    // The marker is dead in every outcome: always clear it (path must match
    // how it was set) so a stale banner can never get stuck.
    // A stale/invalidated marker is still safely "ended": clear local state
    // and send the operator to login when no admin session can be restored.
    const response = NextResponse.json({ ok: true, restored });
    response.cookies.set(MARKER_COOKIE, '', { path: '/', maxAge: 0 });
    response.cookies.set(SUPPORT_MODE_COOKIE, '', { path: '/', maxAge: 0 });
    return response;
  } catch (err) {
    Sentry.captureException(err);
    return NextResponse.json({ error: 'خطأ في الخادم' }, { status: 500 });
  }
}
