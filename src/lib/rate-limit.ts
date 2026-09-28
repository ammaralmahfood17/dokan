/**
 * Rate limiter for Dokan API routes.
 * Priority: Supabase Postgres (production) → in-memory Map (local fallback).
 *
 * Supabase: atomic counter via SECURITY DEFINER RPC (rate_limit_check) — works on
 *   serverless without extra services. This is the production path.
 * In-memory: local development only (per-instance, resets on cold starts).
 */

type RateLimitRecord = {
  count: number;
  resetAt: number;
};

const store = new Map<string, RateLimitRecord>();

// 1.9: one-shot prod alert for in-memory fallback (per serverless instance —
// deliberate: one warning per cold start is the useful signal, not per hit).
let fellBackToInMemoryAlerted = false;

interface RateLimitOptions {
  limit: number;      // max requests
  windowMs: number;   // time window in ms
  keyPrefix?: string;
  /** Optional tenant context forwarded to the DB guard on the
   * rate_limit_check RPC (defense-in-depth when the route knows the caller). */
  projectId?: string;
  callerUserId?: string;
}

interface RateLimitResult {
  allowed: boolean;
  remaining: number;
  resetIn: number;
}

/**
 * Supabase Postgres rate limiter — atomic counter via SECURITY DEFINER RPC.
 * Works on serverless (shared DB, no per-instance state).
 */
async function supabaseRateLimit(
  key: string,
  options: RateLimitOptions
): Promise<RateLimitResult | null> {
  try {
    if (!process.env.SUPABASE_SERVICE_ROLE_KEY) return null;
    const { createAdminClient } = await import('@/lib/supabase/admin');
    const admin = createAdminClient();
    const { data, error } = await admin.rpc('rate_limit_check', {
      p_key: key,
      p_limit: options.limit,
      p_window_ms: options.windowMs,
      ...(options.projectId ? { p_project_id: options.projectId } : {}),
      ...(options.callerUserId ? { p_caller_user_id: options.callerUserId } : {}),
    });
    if (error) return null;
    const result = data as unknown as {
      allowed: boolean;
      remaining: number;
      reset_in: number;
    } | null;
    if (!result) return null;
    return {
      allowed: result.allowed,
      remaining: result.remaining,
      resetIn: Math.round(result.reset_in),
    };
  } catch {
    return null; // Fall through to in-memory
  }
}

export async function rateLimit(
  identifier: string,
  options: RateLimitOptions = { limit: 10, windowMs: 60 * 1000 }
): Promise<RateLimitResult> {
  const key = options.keyPrefix ? `${options.keyPrefix}:${identifier}` : identifier;

  // 1. Supabase Postgres (production path)
  const supabaseResult = await supabaseRateLimit(key, options);
  if (supabaseResult) return supabaseResult;

  // 2. Fallback: in-memory Map (local dev only)
  if (
    process.env.VERCEL_ENV === 'production' &&
    !fellBackToInMemoryAlerted
  ) {
    // A silently weakened (per-instance) rate limiter in prod is itself a
    // security regression — alert once per instance instead of swallowing.
    fellBackToInMemoryAlerted = true;
    import('@sentry/nextjs')
      .then((Sentry) =>
        Sentry.captureMessage('Rate limiter fell back to in-memory', 'warning')
      )
      .catch(() => {});
  }
  const now = Date.now();
  const record = store.get(key);

  if (!record || now > record.resetAt) {
    // Opportunistic eviction — expired keys otherwise grow unbounded.
    if (store.size > 10_000) {
      for (const [k, v] of store) {
        if (now > v.resetAt) store.delete(k);
      }
    }
    store.set(key, { count: 1, resetAt: now + options.windowMs });
    return { allowed: true, remaining: options.limit - 1, resetIn: options.windowMs };
  }

  if (record.count >= options.limit) {
    return { allowed: false, remaining: 0, resetIn: record.resetAt - now };
  }

  record.count += 1;
  return { allowed: true, remaining: options.limit - record.count, resetIn: record.resetAt - now };
}

export function createRateLimitResponse(resetIn: number): { error: string; status: number } {
  const seconds = Math.ceil(resetIn / 1000);
  return {
    error: `طلبات كثيرة. حاول مرة أخرى بعد ${seconds} ثوانٍ.`,
    status: 429,
  };
}
