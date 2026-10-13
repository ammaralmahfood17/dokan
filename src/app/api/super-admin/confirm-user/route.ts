import { NextResponse } from 'next/server';
import * as Sentry from '@sentry/nextjs';
import { withSuperAdmin, isUuid } from '@/lib/api/handler';
import { logSuperAdminAction } from '@/lib/super-admin';

/**
 * POST /api/super-admin/confirm-user?userId=...
 *
 * Manually confirm an account's email — 2026-10 audit remediation, amendment A5
 * (owner decision 3).
 *
 * Why this exists: confirmations are ON, and until SMTP is wired up the
 * confirmation mail may never arrive. Without this action such a merchant is
 * permanently stuck — signup succeeded, login refuses, and nothing in the
 * product can move them forward. This is the escape hatch, deliberately narrow:
 * super-admin only, one user per call, always audited.
 *
 * It does NOT bypass anything else: the account is confirmed, nothing about its
 * tenancy or entitlement changes.
 */
export const POST = withSuperAdmin('confirm-user', async (request, { userId, admin }) => {
  const targetUserId = request.nextUrl.searchParams.get('userId');
  if (!isUuid(targetUserId)) {
    return NextResponse.json({ error: 'userId مطلوب' }, { status: 400 });
  }

  // Read BEFORE writing: confirming an already-confirmed account is a no-op, and
  // the panel should be told so rather than shown a success that changed nothing.
  const { data: target, error: readError } = await admin.auth.admin.getUserById(targetUserId);
  if (readError || !target?.user) {
    return NextResponse.json({ error: 'الحساب غير موجود' }, { status: 404 });
  }

  const targetEmail: string | null = target.user.email ?? null;
  if (target.user.email_confirmed_at) {
    return NextResponse.json({ ok: true, alreadyConfirmed: true, email: targetEmail });
  }

  const { error } = await admin.auth.admin.updateUserById(targetUserId, { email_confirm: true });
  if (error) {
    Sentry.captureException(error);
    return NextResponse.json({ error: 'فشل تأكيد الحساب' }, { status: 500 });
  }

  await logSuperAdminAction({
    actorUserId: userId,
    action: 'user.confirm',
    targetUserId,
    // The email is already known to the actor (they picked the row), and it is
    // the only way to tell two confirmations apart in the audit trail afterwards.
    metadata: { email: targetEmail, means: 'manual (super-admin)' },
  });

  return NextResponse.json({ ok: true, email: targetEmail });
});
