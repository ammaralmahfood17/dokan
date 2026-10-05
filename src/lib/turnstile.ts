import * as Sentry from '@sentry/nextjs';

/**
 * Cloudflare Turnstile verification — owner decisions 7 + 8 (2026-10 audit remediation).
 *
 * Signup is the one unauthenticated write that creates a durable identity, and it is the
 * entry point for trial farming and email bombing. Turnstile is verified server-side, in
 * this process, before the account is created.
 *
 * FAIL CLOSED (decision 8): if the deployment is production and the secret is missing, or
 * Cloudflare cannot be reached, the signup is REFUSED. It never silently degrades to "no
 * captcha" in production — `scripts/validate-env.mjs` additionally refuses to boot such a
 * deployment, so the two layers agree.
 *
 * Outside production (local dev, CI, e2e) an unconfigured Turnstile is a no-op, so the test
 * suite keeps working without a Cloudflare account.
 */

const VERIFY_URL = 'https://challenges.cloudflare.com/turnstile/v0/siteverify';

/** Is this deployment one where an unconfigured captcha must refuse traffic? */
function isProduction(): boolean {
  return process.env.VERCEL_ENV === 'production' || process.env.NODE_ENV === 'production';
}

export function turnstileConfigured(): boolean {
  return Boolean(process.env.TURNSTILE_SECRET?.trim());
}

export type TurnstileResult =
  | { ok: true; skipped: boolean }
  | {
      ok: false;
      reason: 'not-configured' | 'missing-token' | 'rejected' | 'unreachable' | 'misconfigured';
    };

/** Every refusal reason, in one place so the message map cannot drift from the union. */
export type TurnstileFailureReason = Extract<TurnstileResult, { ok: false }>['reason'];

/**
 * Verify a Turnstile token. `fetchImpl` is injectable so the tests never touch the network.
 */
export async function verifyTurnstile(
  token: unknown,
  clientIp: string | null,
  fetchImpl: typeof fetch = fetch
): Promise<TurnstileResult> {
  const secret = process.env.TURNSTILE_SECRET?.trim();

  if (!secret) {
    if (isProduction()) return { ok: false, reason: 'not-configured' };
    // Local/CI: no Cloudflare account is expected here.
    return { ok: true, skipped: true };
  }

  if (typeof token !== 'string' || token.trim().length === 0) {
    return { ok: false, reason: 'missing-token' };
  }

  const form = new URLSearchParams({ secret, response: token.trim() });
  if (clientIp) form.set('remoteip', clientIp);

  try {
    const res = await fetchImpl(VERIFY_URL, {
      method: 'POST',
      headers: { 'content-type': 'application/x-www-form-urlencoded' },
      body: form.toString(),
      // A hung Cloudflare must not hold a signup request open indefinitely.
      signal: AbortSignal.timeout(8000),
    });
    // The BODY is authoritative, not the status: Cloudflare answers 400 with
    // {"success":false,"error-codes":["invalid-input-secret"]} when TURNSTILE_SECRET is wrong.
    // Classifying on the status alone reported a misconfiguration as a network outage — an
    // ops-time confusion with no security benefit (both fail closed).
    let data: { success?: boolean; 'error-codes'?: string[] } | null = null;
    try {
      data = (await res.json()) as { success?: boolean; 'error-codes'?: string[] };
    } catch {
      data = null;
    }
    if (!data || typeof data !== 'object') {
      Sentry.captureMessage(`turnstile: unreadable siteverify body (HTTP ${res.status})`, 'warning');
      return { ok: false, reason: 'unreachable' };
    }
    if (data.success === true) return { ok: true, skipped: false };

    const codes = data['error-codes'] ?? [];
    if (codes.includes('invalid-input-secret')) {
      // Loud, because in production this refuses EVERY signup until the secret is fixed.
      Sentry.captureMessage(
        'turnstile: TURNSTILE_SECRET is invalid — signup is refusing all attempts',
        'error'
      );
      return { ok: false, reason: 'misconfigured' };
    }
    Sentry.captureMessage(`turnstile: rejected (${codes.join(',') || 'no codes'})`, 'info');
    return { ok: false, reason: 'rejected' };
  } catch {
    // Network failure / timeout: fail closed, but leave a trace — a Cloudflare outage
    // blocking signups is a business event, not a silent one.
    Sentry.captureMessage('turnstile: siteverify unreachable', 'error');
    return { ok: false, reason: 'unreachable' };
  }
}

/** The Arabic message a merchant sees for each refusal reason. */
export function turnstileErrorMessage(reason: TurnstileFailureReason): string {
  switch (reason) {
    case 'not-configured':
      return 'التحقق الأمني غير مهيّأ على هذا الخادم. تواصل مع الدعم.';
    case 'misconfigured':
      return 'إعدادات التحقق الأمني غير صحيحة على هذا الخادم. تواصل مع الدعم.';
    case 'missing-token':
      return 'أكمل التحقق الأمني أولاً.';
    case 'rejected':
      return 'فشل التحقق الأمني. حدّث الصفحة وحاول مرة ثانية.';
    case 'unreachable':
      return 'تعذر التحقق الأمني حالياً. حاول بعد قليل.';
  }
}
