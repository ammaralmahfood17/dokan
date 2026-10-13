import { NextResponse } from 'next/server';
import * as Sentry from '@sentry/nextjs';
import { withSuperAdmin, readJsonBody } from '@/lib/api/handler';

/**
 * POST /api/super-admin/hard-delete-project
 * Body: { projectId, confirmName, reason }
 *
 * Permanent deletion is available only after 30 days in the archive. The
 * database RPC re-checks the name, reason, archive age, super-admin identity,
 * writes the audit event, and deletes in one transaction.
 */
export const POST = withSuperAdmin('hard-delete-project', async (request, { userId, admin }) => {
  const parsed = await readJsonBody(request);
  if (!parsed.ok) return parsed.response;
  const body = parsed.body as { projectId?: string; confirmName?: string; reason?: string };

  const reason = (body.reason ?? '').trim();
  if (!body.projectId) return NextResponse.json({ error: 'projectId مطلوب' }, { status: 400 });
  if (reason.length < 10) {
    return NextResponse.json({ error: 'سبب الحذف يجب أن يكون 10 أحرف على الأقل' }, { status: 400 });
  }

  const { data: project } = await admin
    .from('projects')
    .select('id, name, slug, deleted_at')
    .eq('id', body.projectId)
    .single();
  if (!project) return NextResponse.json({ error: 'المشروع غير موجود' }, { status: 404 });

  if (!project.deleted_at) {
    return NextResponse.json({ error: 'يجب أرشفة المشروع قبل الحذف النهائي' }, { status: 409 });
  }

  const eligibleAt = new Date(project.deleted_at).getTime() + 30 * 86400e3;
  if (eligibleAt > Date.now()) {
    return NextResponse.json(
      {
        error: 'لا يمكن الحذف النهائي قبل مرور 30 يومًا على الأرشفة',
        eligibleAt: new Date(eligibleAt).toISOString(),
      },
      { status: 409 }
    );
  }

  // Exact-name confirmation — server-side, not just UI.
  if ((body.confirmName ?? '').trim() !== project.name) {
    return NextResponse.json(
      { error: 'تأكيد الاسم غير مطابق — اكتب اسم المتجر بالضبط' },
      { status: 400 }
    );
  }

  const { error } = await admin.rpc('super_admin_hard_delete_project', {
    p_project_id: body.projectId,
    p_confirm_name: body.confirmName ?? '',
    p_reason: reason,
    p_caller_user_id: userId,
  });
  if (error) {
    Sentry.captureException(error);
    return NextResponse.json({ error: 'فشل الحذف' }, { status: 500 });
  }

  return NextResponse.json({ ok: true });
});
