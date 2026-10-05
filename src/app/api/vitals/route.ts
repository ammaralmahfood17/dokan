import { NextResponse } from 'next/server';
import * as Sentry from '@sentry/nextjs';
import { rateLimit } from '@/lib/rate-limit';
import { getClientIp } from '@/lib/ip';
import { createAdminClient } from '@/lib/supabase/admin';

/** Core Web Vitals whitelist — anything else is a forged beacon. */
const METRIC_NAMES = new Set(['LCP', 'CLS', 'INP', 'FCP', 'TTFB', 'FID']);

/**
 * Collects Core Web Vitals beacons (see src/components/web-vitals.tsx).
 *
 * Until 2026-09-26 this endpoint was a black hole: it validated the beacon,
 * rate-limited it, and then only wrote to a console.log that was gated behind
 * `NODE_ENV !== 'production'`. In production it therefore accepted the traffic
 * and stored nothing — every page view paid a network round-trip for zero data,
 * and the project had no performance telemetry at all. Migration 0015 adds the
 * `web_vitals` table; rows go there now, with the console line kept for local
 * debugging only.
 *
 * No IP, user id, session, referrer or user agent is persisted — only the app's
 * own route, the metric name and its value. The path is stripped of any query
 * string before it is stored, so a token or an email in a URL cannot land in
 * the table.
 */
export async function POST(request: Request) {
  try {
    const limit = await rateLimit(`ip:${getClientIp(request)}`, {
      // audit T2 #9: 240/min/IP let a single address insert ~345k rows/day into a shared
      // table. 60/min still covers a real page-view burst (one beacon per metric per load).
      limit: 60,
      windowMs: 60 * 1000,
      keyPrefix: 'vitals-ip',
    });
    if (!limit.allowed) {
      return NextResponse.json({ ok: true });
    }

    const body = await request.text();
    // A beacon is a handful of fields; anything larger is not a beacon. Cheap reject
    // before JSON.parse (audit T2 #9).
    if (body.length > 512) {
      return NextResponse.json({ ok: true });
    }
    let parsed: Record<string, unknown> | null = null;
    try { parsed = JSON.parse(body); } catch { /* ignore malformed */ }

    if (
      parsed?.name &&
      typeof parsed.value === 'number' &&
      Number.isFinite(parsed.value) &&
      METRIC_NAMES.has(String(parsed.name))
    ) {
      // Only the pathname. A beacon URL like /menu?table=1&token=… must not
      // persist the query — this is the one place raw client input reaches
      // storage, so it is trimmed and stripped here.
      const rawPath = typeof parsed.path === 'string' ? parsed.path : '/';
      const path = (rawPath.split('?')[0] || '/').slice(0, 80);
      const metric = String(parsed.name);
      // Integer milliseconds. CLS is reported by the browser as a unitless
      // ratio; web-vitals.tsx already scales it ×1000, so clamping here keeps
      // a hostile beacon (1e308) from poisoning the aggregates.
      const valueMs = Math.max(0, Math.min(600_000, Math.round(parsed.value)));

      if (process.env.NODE_ENV !== 'production') {
        console.log(`web-vitals ${metric} ${valueMs}ms path=${path}`);
      }

      const supabase = createAdminClient();
      const { error } = await supabase.from('web_vitals').insert({
        path,
        metric,
        value_ms: valueMs,
      });
      if (error) {
        // Telemetry must never break the page, but a storage failure means the
        // endpoint is silently useless again — which is the exact bug this
        // change fixes. Report it so it can't regress unnoticed.
        Sentry.captureMessage(`[vitals] beacon insert failed: ${error.message}`, 'warning');
      }
    }
  } catch (err) {
    // never block the page on a metrics beacon
    Sentry.captureException(err);
  }

  return NextResponse.json({ ok: true });
}
