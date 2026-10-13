import { NextResponse } from 'next/server';
import { revalidateTag } from 'next/cache';
import * as Sentry from '@sentry/nextjs';
import { withSuperAdmin, readJsonBody, isUuid } from '@/lib/api/handler';
import { logSuperAdminAction } from '@/lib/super-admin';

const PAYMENT_METHODS = ['bank-transfer', 'stc-pay'];

/**
 * POST /api/super-admin/record-payment
 * Super-admin only. Records a manual payment (bank transfer / stc pay), renews
 * the subscription atomically via record_payment_and_renew RPC, and writes an
 * audit entry.
 *
 * Body: { projectId, amount, method, receipt?, notes?, days?, clientRequestId? }
 */
export const POST = withSuperAdmin('record-payment', async (request, { userId, admin }) => {
  const parsed = await readJsonBody(request, 'محتوى الطلب غير صالح');
  if (!parsed.ok) return parsed.response;

  const { projectId, amount, method, receipt, notes, days, clientRequestId } = parsed.body as {
    projectId?: string;
    amount?: number;
    method?: string;
    receipt?: string;
    notes?: string;
    days?: number;
    clientRequestId?: string;
  };

  // Validate required fields
  if (!isUuid(projectId)) {
    return NextResponse.json({ error: 'projectId مطلوب (UUID)' }, { status: 400 });
  }
  // Audit T2 #11: the operator's intent carries a key so a double-submitted form
  // cannot record two payments and renew twice. Absent is allowed (a legacy
  // caller), malformed is not.
  if (clientRequestId !== undefined && !isUuid(clientRequestId)) {
    return NextResponse.json({ error: 'clientRequestId غير صالح (UUID)' }, { status: 400 });
  }
  if (!amount || typeof amount !== 'number' || amount <= 0) {
    return NextResponse.json({ error: 'المبلغ مطلوب ويجب أن يكون أكبر من صفر' }, { status: 400 });
  }
  if (!method || !PAYMENT_METHODS.includes(method)) {
    return NextResponse.json({ error: 'طريقة الدفع يجب أن تكون bank-transfer أو stc-pay' }, { status: 400 });
  }
  if (receipt && typeof receipt !== 'string') {
    return NextResponse.json({ error: 'رقم الإيصال غير صالح' }, { status: 400 });
  }

  const renewalDays = typeof days === 'number' && days > 0 && days <= 365 ? days : 30;

  // Verify project exists
  const { data: project } = await admin
    .from('projects')
    .select('id, name, slug')
    .eq('id', projectId)
    .single();
  if (!project) return NextResponse.json({ error: 'المشروع غير موجود' }, { status: 404 });

  // Atomically record payment + renew.
  const { data: newExpiry, error } = await admin.rpc('record_payment_and_renew', {
    p_project_id: projectId,
    p_amount: amount,
    p_method: method,
    p_receipt: receipt || null,
    p_notes: notes || null,
    p_days: renewalDays,
    p_caller_id: userId,
    // Idempotency (audit T2 #11): a repeat of the same key returns the existing
    // renewal instead of recording a second payment.
    p_client_request_id: clientRequestId ?? null,
  });

  if (error) {
    Sentry.captureException(error);
    return NextResponse.json({ error: 'فشل تسجيل الدفع' }, { status: 500 });
  }

  await logSuperAdminAction({
    actorUserId: userId,
    action: 'subscription.record_payment',
    targetProjectId: projectId,
    metadata: {
      projectName: project.name,
      amount,
      method,
      receipt: receipt || null,
      days: renewalDays,
      newExpiry,
    },
  });

  // `expire: 0` expires the tag IMMEDIATELY, so the next request rebuilds.
  // The previous `'max'` profile is stale-while-revalidate: the first visitor
  // after an edit still got the OLD menu, and only the one after them saw the
  // change. For a merchant editing a price or hiding an item that delay is a
  // sale sold at the wrong price.
  revalidateTag(`menu-${projectId}`, { expire: 0 });

  return NextResponse.json({
    ok: true,
    subscription_expires_at: newExpiry,
    message: `تم تسجيل ${amount} د.ب عبر ${method === 'bank-transfer' ? 'تحويل بنكي' : 'stc pay'} — التجديد حتى ${new Date(newExpiry).toLocaleDateString('ar-BH')}`,
  });
});
