import { NextRequest, NextResponse } from 'next/server';
import { createAdminClient } from '@/lib/supabase/admin';
import { rateLimit, createRateLimitResponse } from '@/lib/rate-limit';
import { getClientIp } from '@/lib/ip';
import { requireTableToken } from '@/lib/public-write-guard';

// NOTE: This route is currently UNUSED by the frontend (no "call waiter"
// button exists in the menu UI). It's documented in README as a planned
// feature; kept intentionally — product-scope decision pending (build the
// menu frontend for it, or remove it). Do not flag as accidental dead code.

/**
 * POST /api/public/waiter
 * Customer requests waiter attention — logged as a zero-amount order note.
 * No direct client DB writes.
 * Rate limited + existing anti-spam.
 *
 * Security: Uses service role only after slug + active validation.
 */
export async function POST(request: NextRequest) {
  try {
    const body = (await request.json()) as {
      projectSlug?: string;
      tableSlug?: string;
      /** Table scan token from the printed QR (audit T2 #3). */
      tableToken?: string;
    };

    // A literal `null` body is valid JSON, so request.json() returns null and
    // the next line would throw a TypeError -> a 500 on unauthenticated input.
    if (body === null || typeof body !== 'object' || Array.isArray(body)) {
      return NextResponse.json({ error: 'بيانات غير صالحة' }, { status: 400 });
    }
    const projectSlug = body.projectSlug?.trim();
    const tableSlug = body.tableSlug?.trim();

    if (!projectSlug || !tableSlug) {
      return NextResponse.json({ error: 'بيانات ناقصة' }, { status: 400 });
    }

    // Slug hardening: DB slugs are generated lowercase [a-z0-9-], bounded.
    // Reject oversized/malformed input before it reaches rate-limit keys or
    // the DB (defense against log/DB abuse via arbitrary-length payloads).
    if (projectSlug.length > 64 || !/^[a-z0-9-]+$/.test(projectSlug)) {
      return NextResponse.json({ error: 'معرّف المتجر غير صالح' }, { status: 400 });
    }
    if (tableSlug.length > 64 || !/^[a-z0-9-]+$/.test(tableSlug)) {
      return NextResponse.json({ error: 'معرّف الطاولة غير صالح' }, { status: 400 });
    }

    // Strict rate limit for waiter calls (anti-abuse) — first IP only; a
    // comma-list header would otherwise make the key vary per proxy hop.
    // B3: two independent limits — per (table+IP) burst AND a global per-IP
    // cap so one IP can't fan out across many tables in the same minute.
    const ip = getClientIp(request);
    const rateKey = `${projectSlug}:${tableSlug}:${ip}`;
    const [limitResult, ipLimitResult] = await Promise.all([
      rateLimit(rateKey, { limit: 8, windowMs: 60 * 1000, keyPrefix: 'public-waiter' }),
      rateLimit(`ip:${ip}`, { limit: 20, windowMs: 60 * 1000, keyPrefix: 'public-waiter-ip' }),
    ]);

    if (!limitResult.allowed) {
      const res = createRateLimitResponse(limitResult.resetIn);
      return NextResponse.json({ error: res.error }, { status: res.status });
    }
    if (!ipLimitResult.allowed) {
      const res = createRateLimitResponse(ipLimitResult.resetIn);
      return NextResponse.json({ error: res.error }, { status: res.status });
    }

    const supabase = createAdminClient();

    const { data: project } = await supabase
      .from('projects')
      .select('id')
      .eq('slug', projectSlug)
      .eq('is_active', true)
      .single();

    if (!project) {
      return NextResponse.json({ error: 'المتجر غير موجود' }, { status: 404 });
    }

    // Audit T2 #3: this endpoint writes rows into `orders` with the service role and is
    // unauthenticated. The anti-spam check below only blocks a repeat for the SAME table,
    // and every table slug is public — so table rotation was the bypass. Two fixes:
    //   1. the caller must prove the scanned table (same rule as public ordering, T2 #1);
    //   2. a per-PROJECT hourly budget, which rotation cannot dodge.
    const tokenDecision = requireTableToken(body.tableToken);
    if (!tokenDecision.ok) {
      return NextResponse.json({ error: tokenDecision.error }, { status: tokenDecision.status });
    }
    const tableToken = tokenDecision.token;

    const projectBudget = await rateLimit(`project:${project.id}`, {
      limit: 30,
      windowMs: 60 * 60 * 1000,
      keyPrefix: 'public-service-project',
    });
    if (!projectBudget.allowed) {
      const res = createRateLimitResponse(projectBudget.resetIn);
      return NextResponse.json({ error: res.error }, { status: res.status });
    }

    const { data: table } = await supabase
      .from('tables')
      .select('id, number, qrcode')
      .eq('slug', tableSlug)
      .eq('project_id', project.id)
      .eq('is_active', true)
      .maybeSingle();

    // `tableToken === ''` is the REQUIRE_TABLE_TOKEN rollout window: accepted and flagged,
    // never treated as a match.
    if (!table || (tableToken !== '' && table.qrcode !== tableToken)) {
      return NextResponse.json({ error: 'الطاولة غير موجودة أو رمز الطاولة غير صالح' }, { status: 404 });
    }

    // Anti-spam: block if same table already has an open waiter call (5 min)
    const since = new Date(Date.now() - 5 * 60 * 1000).toISOString();
    const { data: recent } = await supabase
      .from('orders')
      .select('id')
      .eq('project_id', project.id)
      .eq('table_id', table.id)
      .eq('status', 'pending')
      .eq('service_type', 'waiter')
      .gte('created_at', since)
      .limit(1)
      .maybeSingle();

    if (recent) {
      return NextResponse.json(
        { error: 'تم إرسال طلب موظف مؤخراً' },
        { status: 429 }
      );
    }

    const { data: order, error } = await supabase
      .from('orders')
      .insert({
        project_id: project.id,
        table_id: table.id,
        type: 'dinein',
        status: 'pending',
        total_amount: 0,
        service_type: 'waiter',
        notes: `🔔 طلب موظف — طاولة ${table.number}`,
      })
      .select('id')
      .single();

    if (error || !order) {
      return NextResponse.json({ error: 'فشل إرسال الطلب' }, { status: 500 });
    }

    return NextResponse.json({ ok: true, id: order.id });
  } catch (err) {
    console.error('Waiter API error:', err);
    return NextResponse.json({ error: 'خطأ داخلي' }, { status: 500 });
  }
}
