import { NextRequest, NextResponse } from 'next/server';
import * as Sentry from '@sentry/nextjs';
import { limitSuperAdmin } from '@/lib/super-admin-rate-limit';
import { createClient } from '@/lib/supabase/server';
import { createAdminClient } from '@/lib/supabase/admin';

/**
 * POST /api/super-admin/hard-delete-project
 * Body: { projectId, confirmName, reason }
 *
 * Permanent deletion is available only after 30 days in the archive. The
 * database RPC re-checks the name, reason, archive age, super-admin identity,
 * writes the audit event, and deletes in one transaction.
 */
export async function POST(request: NextRequest) {
  try {
    const userClient = await createClient();
    const {
      data: { user },
    } = await userClient.auth.getUser();
    if (!user) return NextResponse.json({ error: 'غير مصرح' }, { status: 401 });

    const { data: isAdmin } = await userClient.rpc('is_super_admin');
    if (!isAdmin) return NextResponse.json({ error: 'غير مصرح' }, { status: 403 });

    // Defence in depth: this route is gated by is_super_admin() and the
    // underlying RPC is service_role-only, so the limit is not closing a live
    // bypass — it stops a stolen admin session from hammering the endpoint
    // (each call costs a getUser() + an is_super_admin() RPC before the work
    // is even rejected). Keyed on the admin's user id, not their IP, so a shared
    // office connection can't lock out a real admin.
    const throttled = await limitSuperAdmin(request, user.id, 'hard-delete-project');
    if (throttled) return throttled;

        // audit follow-up: a non-JSON body made request.json() throw and the catch-all
    // answered 500 + Sentry noise for input nobody validated. Same shape as the
    // verified public/order fix (W1).
    const rawBody = await request.json().catch(() => null);
    if (rawBody === null || typeof rawBody !== 'object' || Array.isArray(rawBody)) {
      return NextResponse.json({ error: 'بيانات غير صالحة' }, { status: 400 });
    }
    const body = rawBody as {
      projectId?: string;
      confirmName?: string;
      reason?: string;
    };
    const reason = (body.reason ?? '').trim();
    if (!body.projectId) return NextResponse.json({ error: 'projectId مطلوب' }, { status: 400 });
    if (reason.length < 10) {
      return NextResponse.json({ error: 'سبب الحذف يجب أن يكون 10 أحرف على الأقل' }, { status: 400 });
    }

    const admin = createAdminClient();
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
        { error: 'لا يمكن الحذف النهائي قبل مرور 30 يومًا على الأرشفة', eligibleAt: new Date(eligibleAt).toISOString() },
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
      p_caller_user_id: user.id,
    });
    if (error) {
      Sentry.captureException(error);
      return NextResponse.json({ error: 'فشل الحذف' }, { status: 500 });
    }

    return NextResponse.json({ ok: true });
  } catch (err) {
    Sentry.captureException(err);
    return NextResponse.json({ error: 'خطأ في الخادم' }, { status: 500 });
  }
}
