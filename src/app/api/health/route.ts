import { NextResponse } from 'next/server';
import { createAdminClient } from '@/lib/supabase/admin';
import { rateLimit } from '@/lib/rate-limit';
import { getClientIp } from '@/lib/ip';

/**
 * GET /api/health — liveness + dependency probe.
 *
 * Vercel/monitoring needs a single cheap endpoint that answers "is this
 * deployment alive, and are its dependencies reachable?" — a failing uptime
 * check has to point at a CAUSE, not just report a 500. So this returns a
 * per-dependency breakdown rather than one opaque status.
 *
 * Deliberate design choices:
 *   * Only READS. A health check that writes (or purges) turns monitoring into a
 *     load generator and can fail under exactly the conditions it is meant to
 *     detect.
 *   * Unauthenticated, but leaks NOTHING: no table names, no row counts, no
 *     error strings from Supabase, no version info. A public endpoint that
 *     echoes `relation "orders" does not exist` hands an attacker a free map of
 *     the schema. Failures are reported as a bare "down" plus the dependency
 *     name.
 *   * `light=1` does a single trivial query for uptime checkers that only need
 *     liveness and must not add load.
 */

export const dynamic = 'force-dynamic';

type Check = { ok: boolean; ms: number; detail?: 'down' | 'skipped' };

async function timed<T>(
  fn: () => Promise<T>,
  timeoutMs = 4_000
): Promise<{ value?: T; check: Check }> {
  const started = Date.now();
  let timer: ReturnType<typeof setTimeout> | undefined;
  try {
    const value = await Promise.race([
      fn(),
      new Promise<never>((_, reject) => {
        timer = setTimeout(() => reject(new Error('timeout')), timeoutMs);
      }),
    ]);
    return { value, check: { ok: true, ms: Date.now() - started } };
  } catch {
    return { check: { ok: false, ms: Date.now() - started, detail: 'down' } };
  } finally {
    if (timer) clearTimeout(timer);
  }
}

export async function GET(request: Request) {
  const light = new URL(request.url).searchParams.get('light') === '1';

  // Audit T2 #8: this endpoint is unauthenticated and used to report which alert channels
  // were configured — i.e. whether anyone would be paged BEFORE an attacker abused the
  // public order endpoints. Detail now needs a bearer token; without HEALTH_TOKEN configured
  // the response degrades to a bare liveness probe (fail safe, never fail open).
  const healthToken = process.env.HEALTH_TOKEN;
  const privileged =
    Boolean(healthToken) && request.headers.get('authorization') === `Bearer ${healthToken}`;

  // Also unrate-limited before: each call ran a DB query, so it doubled as a cheap
  // amplification target.
  const rate = await rateLimit(`ip:${getClientIp(request)}`, {
    limit: 30,
    windowMs: 60 * 1000,
    keyPrefix: 'health-ip',
  });
  if (!rate.allowed) {
    return NextResponse.json(
      { status: 'degraded' },
      { status: 429, headers: { 'Cache-Control': 'no-store', 'X-Robots-Tag': 'noindex, nofollow' } }
    );
  }

  // 1. The app itself is running — that is implied by serving this response.
  const runtime: Check = { ok: true, ms: 0 };

  // 2. Can we authenticate to Supabase with the service key at all? A missing
  //    or rotated key is the single most common production breakage, and it is
  //    invisible until a real request fails.
  const coreConfigured = Boolean(
    process.env.NEXT_PUBLIC_SUPABASE_URL &&
      process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY &&
      process.env.SUPABASE_SERVICE_ROLE_KEY
  );
  const env: Check = {
    ok: coreConfigured,
    ms: 0,
    ...(coreConfigured ? {} : { detail: 'down' }),
  };

  // 3. Does the database actually answer, and is the schema reachable?
  let database: Check = { ok: false, ms: 0, detail: 'skipped' };
  if (coreConfigured) {
    const probe = await timed(async () => {
      const supabase = createAdminClient();
      // `limit(1)` on the single most fundamental table. A missing relation
      // means migrations are out of sync — exactly what an operator needs to
      // know at 3am, and something the app's own errors would only reveal
      // reportingly.
      const { error } = await supabase.from('projects').select('id').limit(1);
      if (error) throw new Error('db');
      return true;
    });
    database = probe.check;
  }

  const checks = { runtime, env, database };
  const healthy = Object.values(checks).every((c) => c.ok);
  const integrations = {
    push: Boolean(
      process.env.NEXT_PUBLIC_VAPID_PUBLIC_KEY && process.env.VAPID_PRIVATE_KEY
    ),
    telegram: Boolean(
      process.env.TELEGRAM_BOT_TOKEN && process.env.TELEGRAM_WEBHOOK_SECRET
    ),
    browserMonitoring: Boolean(
      process.env.NEXT_PUBLIC_SENTRY_DSN || process.env.SENTRY_DSN
    ),
    sourceMaps: Boolean(
      process.env.SENTRY_ORG &&
        process.env.SENTRY_PROJECT &&
        process.env.SENTRY_AUTH_TOKEN
    ),
  };

  return NextResponse.json(
    {
      status: healthy ? 'ok' : 'degraded',
      // Per-dependency, not a boolean blob: the whole point is knowing WHICH
      // one broke.
      checks,
      // `integrations` names the alert channels that are live — recon for an attacker
      // deciding whether anyone would notice. Token-gated (audit T2 #8).
      ...(privileged && !light
        ? { integrations, timestamp: new Date().toISOString() }
        : {}),
    },
    {
      status: healthy ? 200 : 503,
      headers: {
        // P2 (audit 2026-10-10): uptime monitors hit this endpoint every minute and EVERY tick paid a
        // DB round trip plus the env checks. `?light=1` is the mode built for exactly those callers
        // (one trivial query), so the LIGHT answer is edge-cached for 30s with a 60s revalidation
        // window — cheap, and at most 30s stale for a liveness signal.
        //
        // The full dependency breakdown deliberately stays `no-store`: caching an "ok" that outlives
        // the outage it is supposed to report is worse than no health check at all. Point monitors at
        // /api/health?light=1 to get the cached path.
        'Cache-Control': light
          ? 'public, s-maxage=30, stale-while-revalidate=60'
          : 'no-store',
        'X-Robots-Tag': 'noindex, nofollow',
      },
    }
  );
}
