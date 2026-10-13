import { NextResponse } from 'next/server';
import { revalidateTag } from 'next/cache';
import * as Sentry from '@sentry/nextjs';
import { withSuperAdmin, isUuid } from '@/lib/api/handler';
import { logSuperAdminAction } from '@/lib/super-admin';

/**
 * POST /api/super-admin/deactivate?projectId=...
 * Super-admin only. Re-checks membership at mutation time. Flips is_active off
 * immediately (abuse / non-payment before natural expiry). Logged.
 */
export const POST = withSuperAdmin('deactivate', async (request, { userId, admin }) => {
  const projectId = request.nextUrl.searchParams.get('projectId');
  if (!isUuid(projectId)) {
    return NextResponse.json({ error: 'projectId مطلوب (UUID)' }, { status: 400 });
  }

  const { data: project } = await admin
    .from('projects')
    .select('id, name, slug, is_active')
    .eq('id', projectId)
    .single();
  if (!project) return NextResponse.json({ error: 'المشروع غير موجود' }, { status: 404 });
  if (!project.is_active) {
    return NextResponse.json({ error: 'المشروع موقوف أصلًا' }, { status: 409 });
  }

  const { error } = await admin.rpc('super_admin_deactivate_project', {
    p_project_id: projectId,
    p_caller_user_id: userId,
  });
  if (error) {
    Sentry.captureException(error);
    return NextResponse.json({ error: 'فشل الإيقاف' }, { status: 500 });
  }

  await logSuperAdminAction({
    actorUserId: userId,
    action: 'project.deactivate',
    targetProjectId: projectId,
    metadata: { projectName: project.name, slug: project.slug },
  });

  // F4: a deactivated store must stop serving its menu right away, not up to
  // 60s later (unstable_cache TTL) — same `expire: 0` reasoning as archive.
  revalidateTag(`menu-${projectId}`, { expire: 0 });

  return NextResponse.json({ ok: true });
});
