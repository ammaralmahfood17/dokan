import { NextRequest, NextResponse } from 'next/server';
import * as Sentry from '@sentry/nextjs';
import { limitSuperAdmin } from '@/lib/super-admin-rate-limit';
import { createClient } from '@/lib/supabase/server';
import { createAdminClient } from '@/lib/supabase/admin';
import { logSuperAdminAction } from '@/lib/super-admin';
import { generateSlug, isReservedSlug } from '@/lib/utils';

/**
 * POST /api/super-admin/create-project
 * Body: { name, ownerEmail, slug? }
 *
 * Creates a project on behalf of a customer. The owner must be an existing
 * user (looked up by email) — inviting brand-new users is deliberately NOT
 * part of this surface (signup flows handle that); if the email doesn't
 * exist, the request fails cleanly so Ammar can onboard via the normal path.
 * Reuses the app's own slug generation + reserved-word checks.
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
    const throttled = await limitSuperAdmin(request, user.id, 'create-project');
    if (throttled) return throttled;

        // audit follow-up: a non-JSON body made request.json() throw and the catch-all
    // answered 500 + Sentry noise for input nobody validated. Same shape as the
    // verified public/order fix (W1).
    const rawBody = await request.json().catch(() => null);
    if (rawBody === null || typeof rawBody !== 'object' || Array.isArray(rawBody)) {
      return NextResponse.json({ error: 'بيانات غير صالحة' }, { status: 400 });
    }
    const body = rawBody as { name?: string; ownerEmail?: string; slug?: string };
    const name = (body.name ?? '').trim();
    const ownerEmail = (body.ownerEmail ?? '').trim().toLowerCase();
    if (!name || name.length < 2) {
      return NextResponse.json({ error: 'اسم المتجر مطلوب (حرفان على الأقل)' }, { status: 400 });
    }
    if (!/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(ownerEmail)) {
      return NextResponse.json({ error: 'إيميل المالك غير صالح' }, { status: 400 });
    }

    const admin = createAdminClient();

    // Owner must exist — no silent user creation from this surface.
    const { data: users } = await admin.auth.admin.listUsers({ page: 1, perPage: 1000 });
    const owner = users.users.find((u) => u.email?.toLowerCase() === ownerEmail);
    if (!owner) {
      return NextResponse.json(
        { error: 'لا يوجد مستخدم بهذا الإيميل — أنشئه عبر التسجيل العادي أولًا' },
        { status: 404 }
      );
    }

    // Slug: reuse the app's own generation + reserved checks.
    let slug = (body.slug?.trim() || generateSlug(name)).toLowerCase();
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
      user_id: owner.id,
      role: 'owner',
    });
    if (staffErr) {
      await admin.from('projects').delete().eq('id', project.id); // rollback
      Sentry.captureException(staffErr);
      return NextResponse.json({ error: 'فشل ربط المالك بالمشروع' }, { status: 500 });
    }

    await logSuperAdminAction({
      actorUserId: user.id,
      action: 'project.create',
      targetProjectId: project.id,
      targetUserId: owner.id,
      metadata: { projectName: name, slug: finalSlug, ownerEmail },
    });

    return NextResponse.json({ ok: true, project });
  } catch (err) {
    Sentry.captureException(err);
    return NextResponse.json({ error: 'خطأ في الخادم' }, { status: 500 });
  }
}
