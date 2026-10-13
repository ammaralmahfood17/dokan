import { NextResponse } from 'next/server';
import { revalidateTag } from 'next/cache';
import * as Sentry from '@sentry/nextjs';
// F4: purge the project's cached public menu after activation changes.
import { withSuperAdmin, readJsonBody } from '@/lib/api/handler';
import { logSuperAdminAction } from '@/lib/super-admin';

/**
 * POST /api/super-admin/archive-project
 * Body: { projectId, reason }
 *
 * SOFT delete (default). Sets deleted_at + is_active=false: the project
 * vanishes from staff dashboards and listings, data retained. Reason is
 * REQUIRED and stored in the audit metadata.
 *
 * Auth / authorisation / throttle / 500-reporting live in withSuperAdmin — the
 * order inside it (401 → 403 → throttle → body) is part of the contract.
 */
export const POST = withSuperAdmin('archive-project', async (request, { userId, admin }) => {
  const parsed = await readJsonBody(request);
  if (!parsed.ok) return parsed.response;
  const body = parsed.body as { projectId?: string; reason?: string };

  const reason = (body.reason ?? '').trim();
  if (!body.projectId) return NextResponse.json({ error: 'projectId مطلوب' }, { status: 400 });
  if (!reason) return NextResponse.json({ error: 'السبب مطلوب' }, { status: 400 });

  const { data: project } = await admin
    .from('projects')
    .select('id, name, slug, deleted_at')
    .eq('id', body.projectId)
    .single();
  if (!project) return NextResponse.json({ error: 'المشروع غير موجود' }, { status: 404 });
  if (project.deleted_at) return NextResponse.json({ error: 'المشروع مؤرشف أصلًا' }, { status: 409 });

  const { error } = await admin.rpc('super_admin_archive_project', {
    p_project_id: body.projectId,
    p_caller_user_id: userId,
  });
  if (error) {
    Sentry.captureException(error);
    return NextResponse.json({ error: 'فشل الأرشفة' }, { status: 500 });
  }

  await logSuperAdminAction({
    actorUserId: userId,
    action: 'project.archive',
    targetProjectId: body.projectId,
    metadata: { projectName: project.name, slug: project.slug, reason },
  });

  // F4: purge the cached public menu — an archived store must vanish.
  // `expire: 0` expires the tag IMMEDIATELY, so the next request rebuilds. The
  // previous `'max'` profile is stale-while-revalidate: the first visitor after
  // an edit still got the OLD menu. For a merchant editing a price or hiding an
  // item that delay is a sale sold at the wrong price.
  revalidateTag(`menu-${body.projectId}`, { expire: 0 });

  return NextResponse.json({ ok: true });
});
