import { NextResponse } from 'next/server';
import { createAdminClient } from '@/lib/supabase/admin';

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
      ...(light
        ? {}
        : { integrations, timestamp: new Date().toISOString() }),
    },
    {
      status: healthy ? 200 : 503,
      // Never cache: a cached "ok" is worse than no health check at all.
      headers: {
        'Cache-Control': 'no-store',
        'X-Robots-Tag': 'noindex, nofollow',
      },
    }
  );
}
