import { NextResponse } from 'next/server';
import * as Sentry from '@sentry/nextjs';
import { withSuperAdmin, readJsonBody } from '@/lib/api/handler';
import {
  startImpersonation,
  logSuperAdminAction,
  MARKER_COOKIE,
  SUPPORT_MODE_COOKIE,
} from '@/lib/super-admin';
import type { Json } from '@/lib/database.types';

/**
 * POST /api/super-admin/impersonate
 * Body: { targetUserId: string, projectId?: string }
 *
 * Super-admin only. Mints a non-refreshable target session capped at 30 minutes,
 * stores the admin session for restoration, and writes an audit entry.
 *
 * The error mapping is route-owned (an `onError` hook): an MFA-protected target
 * is a 409 the operator should read, and a misconfigured JWT lifetime is a 503
 * that must be alerted — neither is the shared 500.
 */
export const POST = withSuperAdmin(
  'impersonate',
  async (request, { userId, client }) => {
    const parsed = await readJsonBody(request);
    if (!parsed.ok) return parsed.response;
    const body = parsed.body as { targetUserId?: string; projectId?: string };

    if (!body.targetUserId || typeof body.targetUserId !== 'string') {
      return NextResponse.json({ error: 'targetUserId مطلوب' }, { status: 400 });
    }

    // Capture the admin's CURRENT session BEFORE swapping (restore on end).
    const {
      data: { session: adminSession },
    } = await client.auth.getSession();
    if (!adminSession) return NextResponse.json({ error: 'لا جلسة' }, { status: 500 });

    const result = await startImpersonation({
      actorUserId: userId,
      actorSession: adminSession as unknown as Json,
      targetUserId: body.targetUserId,
      targetProjectId: body.projectId ?? null,
    });

    await logSuperAdminAction({
      actorUserId: userId,
      action: 'impersonation.start',
      targetProjectId: body.projectId ?? null,
      targetUserId: body.targetUserId,
      metadata: { sessionId: result.sessionId, expiresAt: result.expiresAt },
    });

    const response = NextResponse.json({
      ok: true,
      sessionId: result.sessionId,
      expiresAt: result.expiresAt,
    });

    // Write the SSR auth cookie here, in the exact shape @supabase/ssr reads
    // (`base64-` + base64url(JSON)). The client used to call supabase.auth.setSession(),
    // which validates the refresh token and fails with "Auth session missing!" for the
    // non-refreshable placeholder — the API said 200 while the browser never logged in.
    const ref = new URL(process.env.NEXT_PUBLIC_SUPABASE_URL!).hostname.split('.')[0];
    const maxAge = Math.max(60, Math.floor((Date.parse(result.expiresAt) - Date.now()) / 1000));
    response.cookies.set(
      `sb-${ref}-auth-token`,
      `base64-${Buffer.from(JSON.stringify(result.targetSession)).toString('base64url')}`,
      {
        path: '/',
        sameSite: 'lax',
        secure: process.env.NODE_ENV === 'production',
        maxAge,
      }
    );
    // Support-mode marker: httpOnly so page JS (including any XSS on public
    // surfaces) can never read it. The end route is the only consumer.
    response.cookies.set(MARKER_COOKIE, result.sessionId, {
      path: '/',
      httpOnly: true,
      sameSite: 'lax',
      secure: process.env.NODE_ENV === 'production',
      maxAge: 12 * 60 * 60,
    });
    response.cookies.set(SUPPORT_MODE_COOKIE, '1', {
      path: '/',
      httpOnly: false,
      sameSite: 'lax',
      secure: process.env.NODE_ENV === 'production',
      maxAge: 12 * 60 * 60,
    });
    return response;
  },
  {
    onError: (err) => {
      const message = err instanceof Error ? err.message : 'unknown';
      if (message.includes('MFA')) {
        return NextResponse.json(
          { error: 'المستخدم مفعّل لديه MFA — لا يمكن انتحال الجلسة' },
          { status: 409 }
        );
      }
      if (message.includes('SUPABASE_JWT_EXPIRY_TOO_SHORT')) {
        // The token is about to expire, so there is no honest support window to offer.
        Sentry.captureException(err);
        return NextResponse.json(
          { error: 'انتهت صلاحية جلسة المستخدم الهدف تقريباً — أعد المحاولة بعد لحظات' },
          { status: 503 }
        );
      }
      Sentry.captureException(err);
      return NextResponse.json({ error: 'فشل بدء الجلسة' }, { status: 500 });
    },
  }
);
