import { NextRequest, NextResponse } from 'next/server';
import * as Sentry from '@sentry/nextjs';
import { limitSuperAdmin } from '@/lib/super-admin-rate-limit';
import { createClient } from '@/lib/supabase/server';
import { createAdminClient } from '@/lib/supabase/admin';
import { logSuperAdminAction } from '@/lib/super-admin';

/**
 * POST /api/super-admin/confirm-user?userId=...
 *
 * Manually confirm an account's email — 2026-10 audit remediation, amendment A5
 * (owner decision 3).
 *
 * Why this exists: confirmations are ON, and until SMTP is wired up the confirmation mail
 * may never arrive. Without this action such a merchant is permanently stuck — signup
 * succeeded, login refuses, and nothing in the product can move them forward. This is the
 * escape hatch, deliberately narrow: super-admin only, one user per call, always audited.
 *
 * It does NOT bypass anything else: the account is confirmed, nothing about its tenancy or
 * entitlement changes.
 */

const UUID_RE = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;

export async function POST(request: NextRequest) {
  try {
    // Auth BEFORE input validation (same reasoning as renew): an unauthenticated caller must
    // not be able to learn the request shape from a 400 that arrives ahead of the 401.
    const userClient = await createClient();
    const {
      data: { user },
    } = await userClient.auth.getUser();
    if (!user) return NextResponse.json({ error: 'غير مصرح' }, { status: 401 });

    const { data: isAdmin } = await userClient.rpc('is_super_admin');
    if (!isAdmin) return NextResponse.json({ error: 'غير مصرح' }, { status: 403 });

    const throttled = await limitSuperAdmin(request, user.id, 'confirm-user');
    if (throttled) return throttled;

    const userId = request.nextUrl.searchParams.get('userId');
    if (!userId || !UUID_RE.test(userId)) {
      return NextResponse.json({ error: 'userId مطلوب' }, { status: 400 });
    }

    const admin = createAdminClient();

    // Read BEFORE writing: confirming an already-confirmed account is a no-op, and the panel
    // should be told so rather than shown a success that changed nothing.
    const { data: target, error: readError } = await admin.auth.admin.getUserById(userId);
    if (readError || !target?.user) {
      return NextResponse.json({ error: 'الحساب غير موجود' }, { status: 404 });
    }

    const targetEmail: string | null = target.user.email ?? null;
    if (target.user.email_confirmed_at) {
      return NextResponse.json({ ok: true, alreadyConfirmed: true, email: targetEmail });
    }

    const { error } = await admin.auth.admin.updateUserById(userId, { email_confirm: true });
    if (error) {
      Sentry.captureException(error);
      return NextResponse.json({ error: 'فشل تأكيد الحساب' }, { status: 500 });
    }

    await logSuperAdminAction({
      actorUserId: user.id,
      action: 'user.confirm',
      targetUserId: userId,
      // The email is already known to the actor (they picked the row), and it is the only way
      // to tell two confirmations apart in the audit trail afterwards.
      metadata: { email: targetEmail, means: 'manual (super-admin)' },
    });

    return NextResponse.json({ ok: true, email: targetEmail });
  } catch (err) {
    Sentry.captureException(err);
    return NextResponse.json({ error: 'خطأ في الخادم' }, { status: 500 });
  }
}
