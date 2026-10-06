import { NextRequest, NextResponse, after } from 'next/server';
import * as Sentry from '@sentry/nextjs';
import { createClient } from '@/lib/supabase/server';
import { createAdminClient } from '@/lib/supabase/admin';
import { createSecureOrder } from '@/lib/order-pricing';
import { rateLimit, createRateLimitResponse } from '@/lib/rate-limit';
import { sendPushToProject } from '@/lib/push';
import { sendTelegramAlert } from '@/lib/telegram';
import { formatMoney } from '@/lib/utils';
import type { OrderType, PublicOrderItemInput } from '@/lib/types';

/**
 * POST /api/pos/order
 * Authenticated staff creates walk-in / drive-thru orders.
 * Same server-side pricing rules as public API.
 * Rate limited for abuse protection (even for staff).
 */
export async function POST(request: NextRequest) {
  try {
    const userClient = await createClient();
    // PERF: getSession() reads the JWT locally (~1ms) for the fast path.
    // B1: BUT a locally-read session never learns about revoked tokens —
    // a fired staff member's JWT stays "valid" until expiry. Force a
    // server-side verification via getUser() for this money-mutating route.
    const {
      data: { session },
    } = await userClient.auth.getSession();
    if (!session) {
      return NextResponse.json({ error: 'غير مصرح' }, { status: 401 });
    }

    const {
      data: { user },
      error: userErr,
    } = await userClient.auth.getUser();
    if (userErr || !user) {
      return NextResponse.json({ error: 'غير مصرح' }, { status: 401 });
    }

        // audit follow-up: a non-JSON body made request.json() throw and the catch-all
    // answered 500 + Sentry noise for input nobody validated. Same shape as the
    // verified public/order fix (W1).
    const rawBody = await request.json().catch(() => null);
    if (rawBody === null || typeof rawBody !== 'object' || Array.isArray(rawBody)) {
      return NextResponse.json({ error: 'بيانات غير صالحة' }, { status: 400 });
    }
    const body = rawBody as {
      type?: OrderType;
      items?: PublicOrderItemInput[];
      notes?: string;
      projectId?: string;
    };

    const type: OrderType =
      body.type === 'drivethru' || body.type === 'walkin' || body.type === 'dinein'
        ? body.type
        : 'walkin';

    if (!Array.isArray(body.items) || body.items.length === 0) {
      return NextResponse.json({ error: 'السلة فارغة' }, { status: 400 });
    }

    const { data: memberships } = await userClient
      .from('staff_members')
      .select('project_id, projects(currency)')
      .eq('user_id', user.id);
    const list = memberships ?? [];
    if (!list.length) {
      return NextResponse.json({ error: 'لا يوجد مشروع' }, { status: 403 });
    }
    // UX-report C2: a staff member in MULTIPLE projects must not be resolved
    // to an arbitrary store via .limit(1) (wrong-tenant orders). The POS page
    // always sends its server-rendered projectId; single-membership users are
    // grandfathered for the deploy window (cached SW/PWA clients).
    const bodyPid = (body as { projectId?: unknown }).projectId;
    let membership: (typeof list)[number];
    if (typeof bodyPid === 'string' && bodyPid) {
      if (!/^[0-9a-f-]{36}$/i.test(bodyPid)) {
        return NextResponse.json({ error: 'معرّف متجر غير صالح' }, { status: 400 });
      }
      const hit = list.find((m) => m.project_id === bodyPid);
      if (!hit) {
        return NextResponse.json({ error: 'لست موظفًا في هذا المتجر' }, { status: 403 });
      }
      membership = hit;
    } else if (list.length === 1) {
      membership = list[0];
    } else {
      return NextResponse.json(
        { error: 'معرّف المتجر مطلوب — أنت موظف في أكثر من متجر' },
        { status: 400 }
      );
    }

    // B2: POS must also respect project activity + subscription — an owner
    // could keep using the POS after their store was deactivated/expired
    // (the public menu is cut, but the internal register wasn't). Same
    // SECURITY DEFINER RPC the public order API uses (reads
    // subscription_expires_at exactly; anon/auth can't select that column
    // due to column-scoped grants, so the RPC keeps one source of truth).
    const { data: projSlug } = await userClient
      .from('projects')
      .select('slug')
      .eq('id', membership.project_id)
      .single();
    const { data: isActive } = await userClient.rpc('is_project_publicly_available', {
      p_slug: projSlug?.slug ?? '',
    });
    if (!isActive) {
      return NextResponse.json(
        { error: 'المشروع غير نشط — يرجى التواصل مع الإدارة' },
        { status: 403 }
      );
    }

    // Rate limit POS orders per staff user (prevent spam)
    const rateKey = `${membership.project_id}:${user.id}`;
    const limitResult = await rateLimit(rateKey, {
      limit: 30,
      windowMs: 60 * 1000,
      keyPrefix: 'pos-order',
      projectId: membership.project_id,
      callerUserId: user.id,
    });

    if (!limitResult.allowed) {
      const res = createRateLimitResponse(limitResult.resetIn);
      return NextResponse.json({ error: res.error }, { status: res.status });
    }

    const supabase = createAdminClient();
    // Currency comes from the nested membership.projects select above — no
    // second projects fetch needed.
    const currency =
      (membership as unknown as { projects?: { currency?: string } }).projects
        ?.currency || 'BHD';
    const result = await createSecureOrder(supabase, {
      projectId: membership.project_id,
      currency,
      tableId: null,
      type,
      items: body.items,
      notes: body.notes,
      callerUserId: user.id,
      // No clientRequestId: POS is a staff-entered order with no retry
      // ambiguity — a double tap is a deliberate second order, and the
      // idempotency key is reserved for the anonymous public path where a
      // lost response is indistinguishable from a failed one.
    });

    if (!result.ok) {
      return NextResponse.json({ error: result.error }, { status: result.status });
    }

    const { id: orderId, status: orderStatus, totalAmount, orderNumber } = result.order;

    // Post-create side effects (audit, push, telegram) run AFTER the response
    // is sent via after() — the POS staff sees the success toast immediately
    // instead of waiting for external push/telegram HTTP calls. after() is
    // guaranteed on Vercel (unlike fire-and-forget, which gets frozen).
    // Security unchanged: the order was already created + validated above;
    // these are notifications/logging only.
    after(async () => {
      await Promise.all([
        // Phase 3: Audit log
        (async () => {
          try {
            await supabase.from('order_audit_logs').insert({
              order_id: orderId,
              project_id: membership.project_id,
              event: 'created',
              new_status: orderStatus,
              actor_user_id: user.id,
              metadata: { type, item_count: body.items?.length || 0 },
            });
          } catch (auditErr) {
            console.warn('[Audit] Failed to write order audit log', auditErr);
          }
        })(),

        // Push notification to all staff
        sendPushToProject(membership.project_id, {
          title: '🔔 طلب جديد',
          body: `طلب #${orderNumber} — ${formatMoney(totalAmount, currency)}`,
          url: '/dashboard/kitchen',
          tag: `order-${orderId}`,
        }).catch(() => {}),

        // Telegram alert — free, reliable (works app-closed).
        sendTelegramAlert(membership.project_id, {
          orderNumber,
          totalText: formatMoney(totalAmount, currency),
          context: type === 'drivethru' ? '🚗 سفري' : '🛒 كاشير',
        }).catch(() => {}),
      ]);
    });

    return NextResponse.json({
      order: {
        id: orderId,
        status: orderStatus,
        totalAmount,
        orderNumber,
      },
    });
  } catch (err) {
    console.error('POS order API error:', err);
    Sentry.captureException(err);
    return NextResponse.json({ error: 'خطأ داخلي' }, { status: 500 });
  }
}
