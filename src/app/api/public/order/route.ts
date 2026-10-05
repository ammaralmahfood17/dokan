import { NextRequest, NextResponse, after } from 'next/server';
import * as Sentry from '@sentry/nextjs';
import { createAdminClient } from '@/lib/supabase/admin';
import { createSecureOrder } from '@/lib/order-pricing';
import { rateLimit, createRateLimitResponse } from '@/lib/rate-limit';
import { getClientIp } from '@/lib/ip';
import { isTableTokenRequired, requireTableToken } from '@/lib/public-write-guard';
import { sendPushToProject } from '@/lib/push';
import { sendTelegramAlert } from '@/lib/telegram';
import { formatMoney } from '@/lib/utils';
import type { PublicOrderItemInput } from '@/lib/types';

export async function POST(request: NextRequest) {
  try {
    // A non-JSON body (or an empty one) made `request.json()` throw, and the route's
    // catch-all answered 500 — an unauthenticated caller could spend the error budget and
    // fill Sentry. The repo's own e2e/resilience.spec.ts R1 asserts the 400 contract.
    const body = (await request.json().catch(() => null)) as {
      projectSlug?: string;
      tableSlug?: string;
      /**
       * Table scan token (tables.qrcode) from the printed QR. Audit 2026-10-05: the slug
       * alone used to authorise the write, which let anyone inject orders into any active
       * store — the storefront page publishes every table slug.
       */
      tableToken?: string;
      items?: PublicOrderItemInput[];
      notes?: string;
      /**
       * Idempotency key (migration 0014). The client mints ONE uuid per
       * checkout attempt and reuses it for every retry — the offline queue in
       * public/sw.js replays the exact same payload, so without this a lost
       * response means a second real order.
       */
      clientRequestId?: string;
    };

    // `await request.json()` returns null for the literal body `null` — valid
    // JSON, so nothing throws at parse time. Destructuring it then raised a
    // TypeError that surfaced as a 500 on a caller-supplied input, i.e. an
    // unauthenticated visitor could fill the Sentry quota with junk. Reject a
    // non-object body here, with the same 400 as any other malformed input.
    if (body === null || typeof body !== 'object' || Array.isArray(body)) {
      return NextResponse.json({ error: 'بيانات غير صالحة' }, { status: 400 });
    }

    const { projectSlug, tableSlug, items, notes, clientRequestId } = body;

    if (!projectSlug || !tableSlug || !Array.isArray(items) || items.length === 0) {
      return NextResponse.json({ error: 'بيانات غير صالحة' }, { status: 400 });
    }

    // Cap slug length — a 1MB slug would blow up the rate-limit key/query.
    if (projectSlug.length > 100 || tableSlug.length > 100) {
      return NextResponse.json({ error: 'بيانات غير صالحة' }, { status: 400 });
    }

    // Idempotency key must be a real uuid. Accept it only in that exact shape:
    // the value goes into a uuid column, and an unvalidated string would turn
    // a malformed body into a 500 from the cast instead of a clean 400. A key
    // that is present but wrong is REJECTED (not ignored) — silently dropping
    // it would quietly re-open the duplicate-order bug.
    const UUID_RE = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;
    if (clientRequestId !== undefined && clientRequestId !== null) {
      if (typeof clientRequestId !== 'string' || !UUID_RE.test(clientRequestId)) {
        return NextResponse.json({ error: 'بيانات غير صالحة' }, { status: 400 });
      }
    }
    const idempotencyKey = typeof clientRequestId === 'string' ? clientRequestId : null;

    // Rate limit per (project, IP) + per IP. A slug-only budget let one
    // client 429 an entire store's ordering (2026-09-20 hardening: key
    // includes the caller IP so the store budget is per customer; the
    // separate ip key still caps one IP across stores).
    const ip = getClientIp(request);
    const rateKey = `${projectSlug}:${ip}`;
    // Two independent rate-limit checks — run in parallel (each is a DB
    // round-trip; serializing them added ~250ms of pure latency).
    const [limitResult, ipLimitResult] = await Promise.all([
      rateLimit(rateKey, { limit: 20, windowMs: 60 * 1000, keyPrefix: 'public-order' }),
      rateLimit(`ip:${ip}`, { limit: 30, windowMs: 60 * 1000, keyPrefix: 'public-order-ip' }),
    ]);

    if (!limitResult.allowed) {
      const res = createRateLimitResponse(limitResult.resetIn);
      return NextResponse.json({ error: res.error }, { status: res.status });
    }
    if (!ipLimitResult.allowed) {
      const res = createRateLimitResponse(ipLimitResult.resetIn);
      return NextResponse.json({ error: res.error }, { status: res.status });
    }

    // 0. Table scan token — audit T2 #1 (CRITICAL). Deliberately AFTER the rate limits so
    //    that every request is counted (a guard placed first would let an attacker hammer
    //    the endpoint with malformed tokens without ever touching a budget).
    const tokenDecision = requireTableToken(body.tableToken);
    if (!tokenDecision.ok) {
      return NextResponse.json({ error: tokenDecision.error }, { status: tokenDecision.status });
    }
    const tableToken = tokenDecision.token;

    // A6 (rollout-window hardening): while enforcement is OFF a tokenless order is still
    // accepted — the merchant's already-printed sheets have to keep working — so that window
    // carries a TIGHT budget of its own on top of the general one. The general budget is sized
    // for customers; a tokenless flood is not a customer pattern: 10/min and 60/h per project.
    if (tableToken === '' && !isTableTokenRequired()) {
      const [tokenlessMinute, tokenlessHour] = await Promise.all([
        rateLimit(projectSlug, { limit: 10, windowMs: 60 * 1000, keyPrefix: 'public-order-notoken' }),
        rateLimit(projectSlug, {
          limit: 60,
          windowMs: 60 * 60 * 1000,
          keyPrefix: 'public-order-notoken-hour',
        }),
      ]);
      if (!tokenlessMinute.allowed) {
        const res = createRateLimitResponse(tokenlessMinute.resetIn);
        return NextResponse.json({ error: res.error }, { status: res.status });
      }
      if (!tokenlessHour.allowed) {
        const res = createRateLimitResponse(tokenlessHour.resetIn);
        return NextResponse.json({ error: res.error }, { status: res.status });
      }

      // The flip to REQUIRE_TABLE_TOKEN=true is justified by token_present=false having been
      // zero for 48h, so every acceptance has to be visible in ops and not only in SQL. The
      // token itself is never logged — there is none on this path.
      Sentry.captureMessage('public order accepted WITHOUT a table token (rollout window)', {
        level: 'warning',
        tags: { area: 'public-order', token_present: 'false' },
        extra: { projectSlug },
      });
    }

    const supabase = createAdminClient();

    // 1. Validate project — HARD subscription cutoff via the SECURITY
    //    DEFINER RPC (reads subscription_expires_at exactly; anon can't
    //    select that column and pg_cron's daily is_active flip would leak
    //    up to 24h of free orders after expiry).
    const { data: isAvailable } = await supabase.rpc('is_project_publicly_available', {
      p_slug: projectSlug,
    });
    if (!isAvailable) {
      return NextResponse.json({ error: 'المتجر غير متاح' }, { status: 404 });
    }

    const { data: project, error: projectErr } = await supabase
      .from('projects')
      .select('id, currency')
      .eq('slug', projectSlug)
      .single();

    if (projectErr || !project) {
      return NextResponse.json({ error: 'المتجر غير متاح' }, { status: 404 });
    }

    // 2. Validate table belongs to project
    // Audit T2 #1 + amendment A3: resolution goes through the SECURITY DEFINER RPC, so the
    // 128-bit scan token is compared INSIDE the database and never enters this process's
    // memory. Nothing here can leak the token into a log line, a Sentry event, a heap dump
    // or an error message — there is no `select qrcode` and no local variable holding it.
    const { data: resolved } = await supabase.rpc('resolve_table_by_token', {
      p_project_slug: projectSlug,
      p_table_token: tableToken,
    });
    const resolvedTable = resolved as { id: string; number: number } | null;

    let tableId: string | null = resolvedTable?.id ?? null;
    let tableNumber: number | null = resolvedTable?.number ?? null;

    // Rollout window (REQUIRE_TABLE_TOKEN off → tableToken === ''): a tokenless order is
    // still accepted, so identity falls back to the slug. That lookup involves no secret at
    // all. When a token IS present the RPC above is the only path — a wrong or foreign token
    // never reaches this fallback and 404s.
    if (tableToken === '' && !tableId) {
      const { data: bySlug } = await supabase
        .from('tables')
        .select('id, number')
        .eq('slug', tableSlug)
        .eq('project_id', project.id)
        .eq('is_active', true)
        .maybeSingle();
      if (bySlug) {
        tableId = bySlug.id;
        tableNumber = bySlug.number;
      }
    }

    if (!tableId) {
      return NextResponse.json(
        { error: 'الطاولة غير موجودة أو رمز الطاولة غير صالح' },
        { status: 404 }
      );
    }

    // 3. Server-side pricing + insert (core security)
    const result = await createSecureOrder(supabase, {
      projectId: project.id,
      currency: project.currency,
      tableId,
      type: 'dinein',
      items,
      notes: body.notes,
      clientRequestId: idempotencyKey,
    });

    if (!result.ok) {
      return NextResponse.json({ error: result.error }, { status: result.status });
    }

    // A replay returns the order the customer already has. Tell them so (the
    // success screen shows the SAME order number instead of a confusing new
    // one) and skip every side effect below — re-firing push/Telegram would
    // make the kitchen prepare the same plate twice, which is the exact
    // symptom idempotency exists to remove.
    if (result.order.replayed) {
      return NextResponse.json({
        replayed: true,
        order: {
          id: result.order.id,
          status: result.order.status,
          totalAmount: result.order.totalAmount,
          orderNumber: result.order.orderNumber,
        },
      });
    }

    // Post-create side effects (audit, push, telegram) run AFTER the response
    // via after() — the customer sees the confirmation immediately instead
    // of waiting for external push/telegram HTTP calls. after() is guaranteed
    // on Vercel (fire-and-forget gets frozen). Order already created above.
    // Rollout telemetry (audit T2 #1): how many real orders still arrive without a token.
    // This is the number that justifies flipping REQUIRE_TABLE_TOKEN to true — and the only
    // evidence that a printed QR sheet somewhere still needs reprinting.
    if (tableToken === '' && process.env.ORDERS_TOKEN_TELEMETRY !== 'false') {
      Sentry.captureMessage('[order] tokenless order accepted (rollout window)', {
        level: 'warning',
        tags: { projectSlug, tableSlug },
      });
    }

    after(async () => {
      await Promise.all([
        // Phase 3: Audit log
        (async () => {
          try {
            await supabase.from('order_audit_logs').insert({
              order_id: result.order.id,
              project_id: project.id,
              event: 'created',
              new_status: result.order.status,
              metadata: { type: 'dinein', item_count: items?.length || 0, token_present: tableToken !== '' },
            });
          } catch (auditErr) {
            console.warn('[Audit] Failed to write order audit log', auditErr);
            // 1.9: an audit write failure is a compliance-relevant silent
            // failure — alert (Sentry no-ops without a DSN, never throws).
            Sentry.captureException(auditErr);
          }
        })(),

        // Push notification to all staff
        sendPushToProject(project.id, {
          title: '🔔 طلب جديد',
          body: `طلب #${result.order.orderNumber} من القائمة — ${formatMoney(
            result.order.totalAmount,
            project.currency
          )}`,
          url: '/dashboard/kitchen',
          tag: `order-${result.order.id}`,
        }).catch(() => {}),

        // Telegram alert — free, reliable (works app-closed).
        sendTelegramAlert(project.id, {
          orderNumber: result.order.orderNumber,
          totalText: formatMoney(result.order.totalAmount, project.currency),
          ...(tableNumber !== null ? { tableNumber } : {}),
        }).catch(() => {}),
      ]);
    });

    return NextResponse.json({
      order: {
        id: result.order.id,
        status: result.order.status,
        totalAmount: result.order.totalAmount,
        orderNumber: result.order.orderNumber,
      },
    });
  } catch (err) {
    console.error('Public order API error:', err);
    Sentry.captureException(err);
    return NextResponse.json({ error: 'خطأ داخلي' }, { status: 500 });
  }
}
