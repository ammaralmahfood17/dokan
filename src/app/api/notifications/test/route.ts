import { NextRequest, NextResponse } from 'next/server';
import * as Sentry from '@sentry/nextjs';
import { createClient } from '@/lib/supabase/server';
import { sendPushToProject } from '@/lib/push';
import { sendTelegramTestAlert } from '@/lib/telegram';
import { rateLimit, createRateLimitResponse } from '@/lib/rate-limit';

/**
 * POST /api/notifications/test  { projectId }
 *
 * A member-authenticated, rate-limited probe of BOTH alert channels. It exists because "the code
 * is wired" and "my phone buzzed" are different claims, and only the merchant can make the second
 * one — this is the button that turns the question into two numbers.
 *
 * - Authorisation is a READ through the SESSION client (staff_members row); the service role is
 *   never used for the decision.
 * - A channel that was never configured answers `{ sent: 0 }` instead of failing: zero IS the
 *   answer the merchant needs ("nothing is linked"), not an error.
 * - Both senders fan out through the SAME recipient filter as a real order, so the test cannot
 *   pass while a real alert would fail.
 * - Rate limit per user: 5 / 10 min. A merchant tapping twice is fine; a stuck button is not.
 */
export async function POST(request: NextRequest) {
  try {
    const body = (await request.json().catch(() => null)) as { projectId?: string } | null;
    if (!body || typeof body !== 'object' || Array.isArray(body) || !body.projectId) {
      return NextResponse.json({ error: 'بيانات ناقصة' }, { status: 400 });
    }
    const projectId = body.projectId;

    const supabase = await createClient();
    const {
      data: { user },
    } = await supabase.auth.getUser();
    if (!user) return NextResponse.json({ error: 'غير مصرح' }, { status: 401 });

    const { data: membership } = await supabase
      .from('staff_members')
      .select('project_id')
      .eq('user_id', user.id)
      .eq('project_id', projectId)
      .maybeSingle();
    if (!membership) return NextResponse.json({ error: 'غير مصرح' }, { status: 403 });

    const limit = await rateLimit(`notify-test:${user.id}`, {
      limit: 5,
      windowMs: 10 * 60 * 1000,
      keyPrefix: 'notify-test',
    });
    if (limit && !limit.allowed) {
      const { error, status } = createRateLimitResponse(limit.resetIn);
      return NextResponse.json({ error }, { status });
    }

    const [telegram, push] = await Promise.all([
      sendTelegramTestAlert(projectId).catch((error) => {
        Sentry.captureException(error);
        return { sent: 0, failed: 1 };
      }),
      sendPushToProject(projectId, {
        title: '🧪 تنبيه تجريبي',
        body: 'لو وصلتك هذه الرسالة، فإشعارات المتصفح تعمل.',
        url: '/dashboard/kitchen',
        tag: 'notifications-test',
      }).catch((error) => {
        Sentry.captureException(error);
        return { sent: 0, failed: 1 };
      }),
    ]);

    return NextResponse.json({ telegram, push });
  } catch (error) {
    Sentry.captureException(error);
    return NextResponse.json({ error: 'تعذّر إرسال التنبيه' }, { status: 500 });
  }
}
