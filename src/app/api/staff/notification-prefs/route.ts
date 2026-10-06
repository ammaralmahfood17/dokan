import { NextRequest, NextResponse } from 'next/server';
import { createClient } from '@/lib/supabase/server';

/**
 * GET/PUT /api/staff/notification-prefs
 * Read / update the current staff member's notification channel preferences.
 *
 * RLS-gated: update runs through the authenticated server client; the
 * `staff_update_own_prefs` policy (USING + WITH CHECK = user_id = auth.uid())
 * and the column-scoped UPDATE grant (notify_push, notify_telegram) allow a
 * staff member to touch only their own pref columns.
 */

async function requireMembership(supabase: Awaited<ReturnType<typeof createClient>>) {
  const {
    data: { user },
  } = await supabase.auth.getUser();
  if (!user) return { error: NextResponse.json({ error: 'غير مصرح' }, { status: 401 }) };
  return { user };
}

export async function GET(request: NextRequest) {
  const supabase = await createClient();
  const auth = await requireMembership(supabase);
  if ('error' in auth) return auth.error;

  const projectId = request.nextUrl.searchParams.get('projectId');
  if (!projectId) return NextResponse.json({ error: 'بيانات ناقصة' }, { status: 400 });

  const { data, error } = await supabase
    .from('staff_members')
    .select('notify_push, notify_telegram')
    .eq('user_id', auth.user.id)
    .eq('project_id', projectId)
    .maybeSingle();

  if (error || !data) {
    return NextResponse.json({ error: 'غير مصرح' }, { status: 403 });
  }
  return NextResponse.json({ notify_push: data.notify_push, notify_telegram: data.notify_telegram });
}

export async function PUT(request: NextRequest) {
  const supabase = await createClient();
  const auth = await requireMembership(supabase);
  if ('error' in auth) return auth.error;

    // audit follow-up: a non-JSON body made request.json() throw and the catch-all
  // answered 500 + Sentry noise for input nobody validated. Same shape as the
  // verified public/order fix (W1).
  const rawBody = await request.json().catch(() => null);
  if (rawBody === null || typeof rawBody !== 'object' || Array.isArray(rawBody)) {
    return NextResponse.json({ error: 'بيانات غير صالحة' }, { status: 400 });
  }
  const body = rawBody as {
    projectId?: string;
    notifyPush?: boolean;
    notifyTelegram?: boolean;
  };
  if (!body.projectId || typeof body.notifyPush !== 'boolean' || typeof body.notifyTelegram !== 'boolean') {
    return NextResponse.json({ error: 'بيانات ناقصة' }, { status: 400 });
  }

  const { data: updated, error } = await supabase
    .from('staff_members')
    .update({ notify_push: body.notifyPush, notify_telegram: body.notifyTelegram })
    .eq('user_id', auth.user.id)
    .eq('project_id', body.projectId)
    .select('id')
    .maybeSingle();

  if (error) {
    console.error('[NotificationPrefs]', error);
    return NextResponse.json({ error: 'فشل الحفظ' }, { status: 500 });
  }

  // 0 rows matched → the caller isn't a member of this project (or it doesn't
  // exist). Don't return a false "تم الحفظ".
  if (!updated) {
    return NextResponse.json({ error: 'غير مصرح' }, { status: 403 });
  }
  return NextResponse.json({ success: true });
}