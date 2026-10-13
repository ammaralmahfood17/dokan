import { NextResponse } from 'next/server';
import { revalidateTag } from 'next/cache';
import * as Sentry from '@sentry/nextjs';
import { withSuperAdmin, isUuid } from '@/lib/api/handler';
import { logSuperAdminAction } from '@/lib/super-admin';

const RENEW_DAYS = 30;

/**
 * POST /api/super-admin/renew?projectId=...
 * Super-admin only. Re-checks membership at mutation time (not page load),
 * renews via the existing renew_subscription RPC, and writes an audit entry.
 */
export const POST = withSuperAdmin('renew', async (request, { userId, admin }) => {
  const projectId = request.nextUrl.searchParams.get('projectId');
  if (!isUuid(projectId)) {
    return NextResponse.json({ error: 'projectId مطلوب' }, { status: 400 });
  }

  const { data: project } = await admin
    .from('projects')
    .select('id, name, slug')
    .eq('id', projectId)
    .single();
  if (!project) return NextResponse.json({ error: 'المشروع غير موجود' }, { status: 404 });

  const { data: newExpiry, error } = await admin.rpc('renew_subscription', {
    p_project_id: projectId,
    p_days: RENEW_DAYS,
    p_caller_user_id: userId,
  });
  if (error) {
    Sentry.captureException(error);
    return NextResponse.json({ error: 'فشل التجديد' }, { status: 500 });
  }

  await logSuperAdminAction({
    actorUserId: userId,
    action: 'subscription.renew',
    targetProjectId: projectId,
    metadata: { projectName: project.name, days: RENEW_DAYS, newExpiry },
  });

  // F4: purge the cached public menu so a renewed store comes back live
  // immediately instead of up to 60s later.
  revalidateTag(`menu-${projectId}`, { expire: 0 });

  return NextResponse.json({ ok: true, subscription_expires_at: newExpiry });
});
