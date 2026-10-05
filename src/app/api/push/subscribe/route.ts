import { NextRequest, NextResponse } from 'next/server';
import { createClient } from '@/lib/supabase/server';
import { rateLimit, createRateLimitResponse } from '@/lib/rate-limit';

async function db() {
  return await createClient();
}

/**
 * POST /api/push/subscribe
 * Save a push subscription for the current user + project
 */
export async function POST(request: NextRequest) {
  try {
    const supabase = await createClient();
    const { data: { user } } = await supabase.auth.getUser();
    if (!user) {
      return NextResponse.json({ error: 'غير مصرح' }, { status: 401 });
    }

    const body = await request.json() as {
      projectId: string;
      subscription: { endpoint: string; keys: { p256dh: string; auth: string } };
    };

    if (!body.projectId || !body.subscription?.endpoint) {
      return NextResponse.json({ error: 'بيانات ناقصة' }, { status: 400 });
    }

    // audit T2 #10: the key material was unvalidated (a missing p256dh became a NOT NULL
    // violation -> 500) and nothing bounded how many subscriptions one staff member could
    // create. Both are cheap to close here.
    const sub = body.subscription;
    const malformed =
      typeof sub.endpoint !== 'string' ||
      sub.endpoint.length > 512 ||
      typeof sub.keys?.p256dh !== 'string' ||
      sub.keys.p256dh.length > 200 ||
      typeof sub.keys?.auth !== 'string' ||
      sub.keys.auth.length > 100;
    if (malformed) {
      return NextResponse.json({ error: 'بيانات الاشتراك غير صالحة' }, { status: 400 });
    }

    const perUser = await rateLimit(`push:${user.id}`, {
      limit: 10,
      windowMs: 60 * 60 * 1000,
      keyPrefix: 'push-subscribe',
    });
    if (!perUser.allowed) {
      const res = createRateLimitResponse(perUser.resetIn);
      return NextResponse.json({ error: res.error }, { status: res.status });
    }

    // Verify the user is a staff member of the target project — otherwise any
    // authenticated user could subscribe to any project's notifications.
    const { data: membership } = await supabase
      .from('staff_members')
      .select('project_id')
      .eq('user_id', user.id)
      .eq('project_id', body.projectId)
      .maybeSingle();

    if (!membership) {
      return NextResponse.json({ error: 'غير مصرح' }, { status: 403 });
    }

    const { error } = await (await db())
      .from('push_subscriptions')
      .insert({
        project_id: body.projectId,
        user_id: user.id,
        endpoint: body.subscription.endpoint,
        p256dh: body.subscription.keys.p256dh,
        auth: body.subscription.keys.auth,
        user_agent: request.headers.get('user-agent')?.slice(0, 200) || null,
      });

    if (error) {
      if (error.message?.includes('unique') || error.code === '23505') {
        return NextResponse.json({ success: true, message: 'مشترك بالفعل' });
      }
      console.error('[Push Subscribe]', error);
      return NextResponse.json({ error: 'فشل الحفظ' }, { status: 500 });
    }

    return NextResponse.json({ success: true });
  } catch (err) {
    console.error('[Push Subscribe]', err);
    return NextResponse.json({ error: 'خطأ داخلي' }, { status: 500 });
  }
}
