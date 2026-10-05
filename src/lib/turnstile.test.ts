import { afterEach, describe, expect, it, vi } from 'vitest';
import {
  turnstileConfigured,
  turnstileErrorMessage,
  verifyTurnstile,
} from '@/lib/turnstile';

/**
 * Owner decisions 7 + 8 (2026-10 audit remediation).
 *
 * The two rules that matter and are asserted here:
 *   1. Outside production an unconfigured Turnstile is a NO-OP, so local dev, vitest and the
 *      e2e suite never need a Cloudflare account.
 *   2. In production an unconfigured or unreachable Turnstile REFUSES the signup. It must
 *      never fall through to "no captcha" — that is the whole point of fail closed.
 */

const TOKEN = '0.abc-turnstile-token';

function jsonResponse(body: unknown, status = 200) {
  return Promise.resolve(
    new Response(JSON.stringify(body), {
      status,
      headers: { 'content-type': 'application/json' },
    })
  );
}

afterEach(() => {
  vi.unstubAllEnvs();
});

describe('unconfigured Turnstile', () => {
  it('is a no-op outside production (local dev, CI, e2e)', async () => {
    vi.stubEnv('TURNSTILE_SECRET', '');
    vi.stubEnv('VERCEL_ENV', '');
    vi.stubEnv('NODE_ENV', 'test');
    expect(turnstileConfigured()).toBe(false);
    expect(await verifyTurnstile('', null)).toEqual({ ok: true, skipped: true });
  });

  it('REFUSES in a Vercel production deploy', async () => {
    vi.stubEnv('TURNSTILE_SECRET', '');
    vi.stubEnv('VERCEL_ENV', 'production');
    expect(await verifyTurnstile(TOKEN, null)).toEqual({ ok: false, reason: 'not-configured' });
  });

  it('REFUSES when NODE_ENV is production (a self-hosted prod build)', async () => {
    vi.stubEnv('TURNSTILE_SECRET', '');
    vi.stubEnv('VERCEL_ENV', '');
    vi.stubEnv('NODE_ENV', 'production');
    expect(await verifyTurnstile(TOKEN, null)).toEqual({ ok: false, reason: 'not-configured' });
  });
});

describe('configured Turnstile', () => {
  it('rejects a missing, empty or non-string token without calling Cloudflare', async () => {
    vi.stubEnv('TURNSTILE_SECRET', 'secret');
    const fetchSpy = vi.fn();
    for (const bad of ['', '   ', undefined, null, 42]) {
      expect(await verifyTurnstile(bad, null, fetchSpy as unknown as typeof fetch)).toEqual({
        ok: false,
        reason: 'missing-token',
      });
    }
    expect(fetchSpy).not.toHaveBeenCalled();
  });

  it('accepts a token Cloudflare confirms, sending secret + response + remoteip', async () => {
    vi.stubEnv('TURNSTILE_SECRET', 'secret');
    const fetchSpy = vi.fn(() => jsonResponse({ success: true }));
    expect(
      await verifyTurnstile(TOKEN, '203.0.113.9', fetchSpy as unknown as typeof fetch)
    ).toEqual({ ok: true, skipped: false });

    const [url, init] = fetchSpy.mock.calls[0] as unknown as [string, RequestInit];
    expect(url).toBe('https://challenges.cloudflare.com/turnstile/v0/siteverify');
    const body = new URLSearchParams(init.body as string);
    expect(body.get('secret')).toBe('secret');
    expect(body.get('response')).toBe(TOKEN);
    expect(body.get('remoteip')).toBe('203.0.113.9');
  });

  it('rejects when Cloudflare says success:false', async () => {
    vi.stubEnv('TURNSTILE_SECRET', 'secret');
    const fetchSpy = vi.fn(() => jsonResponse({ success: false, 'error-codes': ['invalid-input-response'] }));
    expect(await verifyTurnstile(TOKEN, null, fetchSpy as unknown as typeof fetch)).toEqual({
      ok: false,
      reason: 'rejected',
    });
  });

  it('reads a 400 body: invalid-input-secret is a MISCONFIGURATION, not an outage', async () => {
    // Verified against the live endpoint: a wrong secret returns HTTP 400 with
    // {"success":false,"error-codes":["invalid-input-secret"]}. Reporting that as
    // "unreachable" would send an operator hunting a network problem that does not exist.
    vi.stubEnv('TURNSTILE_SECRET', 'wrong');
    const fetchSpy = vi.fn(() =>
      jsonResponse({ success: false, 'error-codes': ['invalid-input-secret'] }, 400)
    );
    expect(await verifyTurnstile(TOKEN, null, fetchSpy as unknown as typeof fetch)).toEqual({
      ok: false,
      reason: 'misconfigured',
    });
  });

  it('treats an unreadable/non-2xx body as a refusal, never a pass', async () => {
    vi.stubEnv('TURNSTILE_SECRET', 'secret');
    const fetchSpy = vi.fn(() =>
      Promise.resolve(new Response('<html>502 Bad Gateway</html>', { status: 502 }))
    );
    expect(await verifyTurnstile(TOKEN, null, fetchSpy as unknown as typeof fetch)).toEqual({
      ok: false,
      reason: 'unreachable',
    });
  });

  it('fails closed when Cloudflare cannot be reached (no silent bypass)', async () => {
    vi.stubEnv('TURNSTILE_SECRET', 'secret');
    const fetchSpy = vi.fn(() => Promise.reject(new Error('ECONNRESET')));
    expect(await verifyTurnstile(TOKEN, null, fetchSpy as unknown as typeof fetch)).toEqual({
      ok: false,
      reason: 'unreachable',
    });
  });

  it('does not leak the secret into the returned reason', async () => {
    vi.stubEnv('TURNSTILE_SECRET', 'super-secret-value');
    const fetchSpy = vi.fn(() => Promise.reject(new Error('boom')));
    const out = await verifyTurnstile(TOKEN, null, fetchSpy as unknown as typeof fetch);
    expect(JSON.stringify(out)).not.toContain('super-secret-value');
  });
});

describe('turnstileErrorMessage()', () => {
  it('has Arabic copy for every refusal reason, with no Latin text', () => {
    for (const reason of [
      'not-configured',
      'misconfigured',
      'missing-token',
      'rejected',
      'unreachable',
    ] as const) {
      const msg = turnstileErrorMessage(reason);
      expect(msg.length).toBeGreaterThan(0);
      expect(msg).not.toMatch(/[A-Za-z]/);
    }
  });
});
