import { NextResponse } from 'next/server';
import * as Sentry from '@sentry/nextjs';
import { withSuperAdmin, readJsonBody } from '@/lib/api/handler';
import { logSuperAdminAction } from '@/lib/super-admin';
import { generateSlug, isReservedSlug } from '@/lib/utils';

/**
 * POST /api/super-admin/create-project
 * Body: { name, ownerEmail, slug? }
 *
 * Creates a project on behalf of a customer. The owner must be an existing user
 * (looked up by email) — inviting brand-new users is deliberately NOT part of
 * this surface (signup flows handle that); if the email doesn't exist, the
 * request fails cleanly so the merchant can be onboarded via the normal path.
 * Reuses the app's own slug generation + reserved-word checks.
 */
export const POST = withSuperAdmin('create-project', async (request, { userId, admin }) => {
  const parsed = await readJsonBody(request);
  if (!parsed.ok) return parsed.response;
  const body = parsed.body as { name?: string; ownerEmail?: string; slug?: string };

  const name = (body.name ?? '').trim();
  const ownerEmail = (body.ownerEmail ?? '').trim().toLowerCase();
  if (!name || name.length < 2) {
    return NextResponse.json({ error: 'اسم المتجر مطلوب (حرفان على الأقل)' }, { status: 400 });
  }
  if (!/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(ownerEmail)) {
    return NextResponse.json({ error: 'إيميل المالك غير صالح' }, { status: 400 });
  }

  // Owner must exist — no silent user creation from this surface.
  //
  // ONE indexed lookup instead of the 1000-user Auth-list scan this route used
  // to do (architecture review 2026-10-13, P2). The Admin API has no
  // "get user by email", so the lookup lives in a service_role-only function —
  // a merchant must not be able to enumerate emails (migration 20261014100000,
  // asserted by supabase/tests/phase9_admin_lookup.sql).
  const { data: ownerId } = await admin.rpc('find_user_id_by_email', { p_email: ownerEmail });
  if (!ownerId) {
    return NextResponse.json(
      { error: 'لا يوجد مستخدم بهذا الإيميل — أنشئه عبر التسجيل العادي أولًا' },
      { status: 404 }
    );
  }

  // Slug: reuse the app's own generation + reserved checks.
  const slug = (body.slug?.trim() || generateSlug(name)).toLowerCase();
  if (isReservedSlug(slug)) {
    return NextResponse.json({ error: 'المعرّف محجوز' }, { status: 409 });
  }
  // Uniqueness with suffix retry (same loop the onboarding route uses).
  let finalSlug = slug;
  let attempt = 0;
  for (;;) {
    const { data: taken } = await admin.from('projects').select('id').eq('slug', finalSlug).maybeSingle();
    if (!taken) break;
    attempt += 1;
    if (attempt > 10) return NextResponse.json({ error: 'تعذر توليد معرّف فريد' }, { status: 409 });
    finalSlug = `${slug}-${attempt}`;
  }

  const { data: project, error: projErr } = await admin
    .from('projects')
    .insert({ name, slug: finalSlug, currency: 'BHD', primary_color: '#7047EB', is_active: true })
    .select('id, name, slug')
    .single();
  if (projErr || !project) {
    Sentry.captureException(projErr);
    return NextResponse.json({ error: 'فشل إنشاء المشروع' }, { status: 500 });
  }

  // Owner membership (same shape as onboarding).
  const { error: staffErr } = await admin.from('staff_members').insert({
    project_id: project.id,
    user_id: ownerId,
    role: 'owner',
  });
  if (staffErr) {
    await admin.from('projects').delete().eq('id', project.id); // rollback
    Sentry.captureException(staffErr);
    return NextResponse.json({ error: 'فشل ربط المالك بالمشروع' }, { status: 500 });
  }

  await logSuperAdminAction({
    actorUserId: userId,
    action: 'project.create',
    targetProjectId: project.id,
    targetUserId: ownerId,
    metadata: { projectName: name, slug: finalSlug, ownerEmail },
  });

  return NextResponse.json({ ok: true, project });
});
