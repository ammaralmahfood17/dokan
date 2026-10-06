import { NextRequest, NextResponse } from 'next/server';
import { createAdminClient } from './supabase/admin';
import { rateLimit, createRateLimitResponse } from './rate-limit';
import { getClientIp } from './ip';
import { requireTableToken } from './public-write-guard';
import { sendPushToProject } from './push';
import { sendTelegramServiceAlert } from './telegram';

/**
 * Customer-initiated service request from the table menu — «طلب موظف» (call a
 * waiter) and «طلب فاتورة» (bring the bill).
 *
 * Why one shared handler: the two routes are the SAME flow with a different
 * label. Duplicating ~150 lines of security-critical validation twice is how
 * the two copies drift and one of them loses a guard (the previous
 * implementation was deleted in b3aab0c after that risk was flagged, while the
 * menu buttons kept calling it — the request silently 404'd).
 *
 * Flow: validate → rate limit → resolve tenant → prove the table → anti-spam →
 * write ONE row into `service_requests` → notify staff (push + Telegram).
 *
 * Security notes:
 *  - `service_requests` is written with the service-role client, so the
 *    boundaries are the checks below, not RLS.
 *  - The caller must prove the scanned table (table scan token) exactly like
 *    public ordering does; a published table slug is not authorisation.
 *  - Anti-spam is BOTH per table (an open request of the same kind blocks a
 *    repeat for 5 minutes) and per project (hourly budget), so rotating table
 *    slugs cannot be used to fan out.
 */

export type ServiceRequestKind = 'waiter' | 'bill';

const LABELS: Record<ServiceRequestKind, { title: string; push: string }> = {
  waiter: { title: 'طلب موظف', push: '🔔 طلب موظف' },
  bill: { title: 'طلب فاتورة', push: '🧾 طلب فاتورة' },
};

/** How long an open request of the same kind blocks another one, per table. */
const DEDUPE_WINDOW_MS = 5 * 60 * 1000;

export async function handleServiceRequest(
  request: NextRequest,
  kind: ServiceRequestKind
): Promise<NextResponse> {
  try {
    // A literal `null` body is valid JSON, so request.json() returns null and
    // destructuring it would throw a TypeError -> a 500 on unauthenticated
    // input. Same contract as the other public write routes.
    const body = (await request.json().catch(() => null)) as {
      projectSlug?: string;
      tableSlug?: string;
      /** Table scan token from the printed QR (same rule as public ordering). */
      tableToken?: string;
    } | null;

    if (body === null || typeof body !== 'object' || Array.isArray(body)) {
      return NextResponse.json({ error: 'بيانات غير صالحة' }, { status: 400 });
    }

    const projectSlug = typeof body.projectSlug === 'string' ? body.projectSlug.trim() : '';
    const tableSlug = typeof body.tableSlug === 'string' ? body.tableSlug.trim() : '';

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

    // Two independent limits — per (project+table+IP) burst AND a global
    // per-IP cap, so one IP cannot fan out across many tables in a minute.
    const ip = getClientIp(request);
    const [limitResult, ipLimitResult] = await Promise.all([
      rateLimit(`${projectSlug}:${tableSlug}:${ip}`, {
        limit: 8,
        windowMs: 60 * 1000,
        keyPrefix: `public-${kind}`,
      }),
      rateLimit(`ip:${ip}`, {
        limit: 20,
        windowMs: 60 * 1000,
        keyPrefix: `public-${kind}-ip`,
      }),
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
      .select('id, name')
      .eq('slug', projectSlug)
      .eq('is_active', true)
      .single();

    if (!project) {
      return NextResponse.json({ error: 'المتجر غير موجود' }, { status: 404 });
    }

    // The caller must prove the scanned table. `tableToken === ''` is the
    // REQUIRE_TABLE_TOKEN rollout window: accepted and flagged, never treated
    // as a match (amendment A6 in public-write-guard).
    const tokenDecision = requireTableToken(body.tableToken);
    if (!tokenDecision.ok) {
      return NextResponse.json({ error: tokenDecision.error }, { status: tokenDecision.status });
    }
    const tableToken = tokenDecision.token;

    // Per-PROJECT hourly budget — table rotation cannot dodge it.
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

    if (!table || (tableToken !== '' && table.qrcode !== tableToken)) {
      return NextResponse.json(
        { error: 'الطاولة غير موجودة أو رمز الطاولة غير صالح' },
        { status: 404 }
      );
    }

    // Anti-spam: one OPEN request of the same kind per table per window.
    const since = new Date(Date.now() - DEDUPE_WINDOW_MS).toISOString();
    const { data: recent } = await supabase
      .from('service_requests')
      .select('id')
      .eq('project_id', project.id)
      .eq('table_id', table.id)
      .eq('type', kind)
      .eq('is_resolved', false)
      .gte('created_at', since)
      .limit(1)
      .maybeSingle();

    if (recent) {
      return NextResponse.json(
        { error: kind === 'waiter' ? 'تم إرسال طلب موظف مؤخراً' : 'تم إرسال طلب الفاتورة مؤخراً' },
        { status: 429 }
      );
    }

    const { data: created, error } = await supabase
      .from('service_requests')
      .insert({ project_id: project.id, table_id: table.id, type: kind })
      .select('id')
      .single();

    if (error || !created) {
      console.error('Service request insert failed:', error);
      return NextResponse.json({ error: 'فشل إرسال الطلب' }, { status: 500 });
    }

    // Notify staff. Awaited on purpose — Vercel freezes the function as soon as
    // the response is returned, so a floating promise is a lost notification.
    // Both paths are best-effort: a push/Telegram failure must not turn a
    // stored request into a customer-visible error.
    await Promise.allSettled([
      sendPushToProject(project.id, {
        title: LABELS[kind].push,
        body: `طاولة ${table.number}`,
        url: '/dashboard/kitchen',
        tag: `service-${kind}-${table.id}`,
      }),
      sendTelegramServiceAlert(project.id, {
        kind,
        tableNumber: table.number,
        projectName: project.name,
      }),
    ]);

    return NextResponse.json({ ok: true, id: created.id });
  } catch (err) {
    console.error(`Service request (${kind}) error:`, err);
    return NextResponse.json({ error: 'خطأ داخلي' }, { status: 500 });
  }
}