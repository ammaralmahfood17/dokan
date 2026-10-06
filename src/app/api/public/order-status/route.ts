import { NextRequest, NextResponse } from 'next/server';
import { createAdminClient } from '@/lib/supabase/admin';
import { rateLimit, createRateLimitResponse } from '@/lib/rate-limit';
import { getClientIp } from '@/lib/ip';

// UX-U1: قراءة حالة الطلب العامة (polling خفيف من شاشة النجاح).
// آمنة بحدود:
//  - إرجاع الحالة فقط (status + created_at) — لا أرقام/مبالغ/بيانات زبون
//  - تحقق tenant: الطلب يجب أن ينتمي لمشروع الـ slug (عبر admin client)
//  - rate limit: لكل ORDER (الأدق) + لكل IP + لكل مشروع
//
// Cadence (2026-10-06, owner report: the customer saw a stale status for up to
// 12s after the kitchen acted): the client polls every 2.5s for the first ~2
// minutes, then every 10s. The budgets below are sized for that, and for a
// café where every customer shares ONE carrier-NAT IP:
//   orderId  45/min  — a 2.5s poll spends 24; the headroom absorbs retries. This
//                      is the key that actually bounds abuse per order.
//   ip       600/min — ~20 customers polling at 2.5s behind one NAT IP.
//   project 2000/min — a 30-table rush at 24/min is 720.
// Each poll is two indexed reads (project by slug, order by PK), so the ceiling
// is ~33 queries/s per project — cheap for Postgres and far below the previous
// effective load, which was a 12s poll repeated by every open tab.
export async function GET(request: NextRequest) {
  try {
    const url = new URL(request.url);
    const orderId = url.searchParams.get('orderId') ?? '';
    const projectSlug = url.searchParams.get('projectSlug') ?? '';

    // UUID صارم — يمنع حقن/تخمين معرفات غير صالحة
    if (
      !/^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i.test(orderId) ||
      projectSlug.length === 0 ||
      projectSlug.length > 100
    ) {
      return NextResponse.json({ error: 'بيانات غير صالحة' }, { status: 400 });
    }

    const ip = getClientIp(request);
    const [ipLimit, projectLimit, orderLimit] = await Promise.all([
      rateLimit(`ip:${ip}`, { limit: 600, windowMs: 60 * 1000, keyPrefix: 'order-status-ip' }),
      rateLimit(projectSlug, { limit: 2000, windowMs: 60 * 1000, keyPrefix: 'order-status' }),
      // Per-order is the tightest and most meaningful key: it bounds how hard a
      // single order can be polled (and so how much a single caller can spend
      // minting junk order ids is bounded by the IP key above).
      rateLimit(orderId, { limit: 45, windowMs: 60 * 1000, keyPrefix: 'order-status-order' }),
    ]);
    if (!ipLimit.allowed) {
      const res = createRateLimitResponse(ipLimit.resetIn);
      return NextResponse.json({ error: res.error }, { status: res.status });
    }
    if (!projectLimit.allowed) {
      const res = createRateLimitResponse(projectLimit.resetIn);
      return NextResponse.json({ error: res.error }, { status: res.status });
    }
    if (!orderLimit.allowed) {
      const res = createRateLimitResponse(orderLimit.resetIn);
      return NextResponse.json({ error: res.error }, { status: res.status });
    }

    const admin = createAdminClient();

    // الطلب ينتمي لمشروع الـ slug؟ (join عبر projects — لا تسريب بين المتاجر)
    const { data: project } = await admin
      .from('projects')
      .select('id')
      .eq('slug', projectSlug)
      .single();

    if (!project) {
      return NextResponse.json({ error: 'غير موجود' }, { status: 404 });
    }

    const { data: order, error } = await admin
      .from('orders')
      .select('status, created_at')
      .eq('id', orderId)
      .eq('project_id', project.id)
      .maybeSingle();

    if (error || !order) {
      return NextResponse.json({ error: 'غير موجود' }, { status: 404 });
    }

    return NextResponse.json({ status: order.status, createdAt: order.created_at });
  } catch {
    return NextResponse.json({ error: 'خطأ داخلي' }, { status: 500 });
  }
}
