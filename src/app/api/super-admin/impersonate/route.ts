import { NextResponse } from 'next/server';
import * as Sentry from '@sentry/nextjs';
import { withSuperAdmin, readJsonBody, isUuid } from '@/lib/api/handler';
import {
  startImpersonation,
  logSuperAdminAction,
  MARKER_COOKIE,
  SUPPORT_MODE_COOKIE,
} from '@/lib/super-admin';
import { writeAuthCookie } from '@/lib/impersonation-cookies';
import { getPublicSupabaseConfig } from '@/lib/env/public';
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
  async (request, { userId, admin, client }) => {
    const parsed = await readJsonBody(request);
    if (!parsed.ok) return parsed.response;
    const body = parsed.body as { targetUserId?: string; projectId?: string };

    if (!isUuid(body.targetUserId)) {
      return NextResponse.json({ error: 'targetUserId مطلوب' }, { status: 400 });
    }
    if (body.projectId !== undefined && body.projectId !== null && !isUuid(body.projectId)) {
      return NextResponse.json({ error: 'projectId غير صالح' }, { status: 400 });
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
    }).catch(async (err: unknown) => {
      // The session row and the target's GoTrue session already exist at this point. If the
      // audit write fails, no cookie has been written, so close the row rather than leave an
      // "active" impersonation nobody can see in the log. The minted access token is never
      // stored anywhere and dies at its own exp.
      await admin.from('impersonation_sessions').delete().eq('id', result.sessionId);
      throw err;
    });

    const response = NextResponse.json({
      ok: true,
      sessionId: result.sessionId,
      expiresAt: result.expiresAt,
    });

    // Swap the browser's session here, on the server. Tokens must never transit JS (they were
    // removed from this response body for that reason), and the support window — not the JWT's
    // own lifetime — must cap the cookie. `writeAuthCookie` owns the @supabase/ssr byte format,
    // including chunking: a single oversize cookie is dropped by browsers, which is exactly the
    // "API 200 but the browser never logged in" failure this route was fixed for.
    const maxAge = Math.max(60, Math.floor((Date.parse(result.expiresAt) - Date.now()) / 1000));
    const { url: supabaseUrl } = getPublicSupabaseConfig();
    try {
      writeAuthCookie(response, supabaseUrl, result.targetSession, maxAge);
    } catch (err) {
      // An unrepresentable session must not leave an "active" row behind.
      await admin.from('impersonation_sessions').delete().eq('id', result.sessionId);
      throw err;
    }
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
      if (message.includes('TARGET_IS_SUPER_ADMIN')) {
        return NextResponse.json(
          { error: 'هذا الحساب مشرف منصة — لا يُسمح بانتحال جلسة مشرف' },
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
