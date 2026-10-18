import { describe, expect, it } from 'vitest';
import { buildCsp, buildStaticCsp, isNoncePath } from './csp';

/** Parse a policy into directive → sources, so assertions read like the header. */
function directives(policy: string): Map<string, string[]> {
  return new Map(
    policy.split(';').map((part) => {
      const [name, ...values] = part.trim().split(/\s+/);
      return [name, values] as const;
    })
  );
}

const NONCE = 'rAnd0m+/base64==';

describe('buildCsp — the page policy', () => {
  const d = directives(buildCsp({ nonce: NONCE }));

  it('carries the nonce verbatim and never allows inline scripts', () => {
    expect(d.get('script-src')).toContain(`'nonce-${NONCE}'`);
    expect(d.get('script-src')).not.toContain("'unsafe-inline'");
  });

  it('adds strict-dynamic so chunks injected by the trusted runtime still load', () => {
    expect(d.get('script-src')).toContain("'strict-dynamic'");
  });

  it('keeps the named third-party origins for CSP2 browsers', () => {
    const scriptSrc = d.get('script-src') ?? [];
    expect(scriptSrc).toContain('https://*.sentry.io');
    expect(scriptSrc).toContain('https://challenges.cloudflare.com');
  });

  it('keeps the rest of the posture', () => {
    expect(d.get('default-src')).toEqual(["'self'"]);
    expect(d.get('frame-ancestors')).toEqual(["'none'"]);
    expect(d.get('object-src')).toEqual(["'none'"]);
    expect(d.get('base-uri')).toEqual(["'self'"]);
    expect(d.get('form-action')).toEqual(["'self'"]);
    expect(d.get('font-src')).toEqual(["'self'", 'data:']);
  });

  it('refuses to build a policy without a nonce', () => {
    // A nonce-less policy is exactly the `unsafe-inline` regression F-18 closed.
    expect(() => buildCsp({ nonce: '' })).toThrow(/nonce/i);
  });

  it('ships unsafe-eval to dev only', () => {
    expect(d.get('script-src')).not.toContain("'unsafe-eval'");
    expect(directives(buildCsp({ nonce: NONCE, dev: true })).get('script-src')).toContain(
      "'unsafe-eval'"
    );
  });

  it('emits upgrade-insecure-requests only for an https site', () => {
    expect(d.has('upgrade-insecure-requests')).toBe(true);
    expect(
      directives(buildCsp({ nonce: NONCE, https: false })).has('upgrade-insecure-requests')
    ).toBe(false);
  });

  it('declares each directive exactly once', () => {
    const names = buildCsp({ nonce: NONCE })
      .split(';')
      .map((part) => part.trim().split(/\s+/)[0]);
    expect(new Set(names).size).toBe(names.length);
  });
});

describe('buildStaticCsp — the cached menu and the 404 shell', () => {
  const d = directives(buildStaticCsp());

  it('allows inline scripts, because that HTML is built once', () => {
    expect(d.get('script-src')).toContain("'unsafe-inline'");
    expect(d.get('script-src')?.some((s) => s.startsWith("'nonce-"))).toBe(false);
    expect(d.get('script-src')).not.toContain("'strict-dynamic'");
  });

  it('keeps every other guarantee identical to the nonce policy', () => {
    const strict = directives(buildCsp({ nonce: NONCE }));
    for (const name of [
      'default-src',
      'frame-ancestors',
      'object-src',
      'base-uri',
      'form-action',
      'connect-src',
      'img-src',
      'font-src',
      'worker-src',
      'style-src',
    ]) {
      expect(d.get(name), name).toEqual(strict.get(name));
    }
  });

  it('ships unsafe-eval to dev only', () => {
    expect(d.get('script-src')).not.toContain("'unsafe-eval'");
    expect(directives(buildStaticCsp({ dev: true })).get('script-src')).toContain("'unsafe-eval'");
  });
});

describe('isNoncePath — which routes can carry a nonce', () => {
  it('covers the pages that render per request', () => {
    for (const path of [
      '/',
      '/login',
      '/register',
      '/reset-password',
      '/update-password',
      '/onboarding',
      '/terms',
      '/privacy',
      '/store-unavailable',
      '/subscription-expired',
      '/dashboard',
      '/dashboard/orders',
      '/super-admin/users',
      '/estikana', // the tenant storefront (single segment)
    ]) {
      expect(isNoncePath(path), path).toBe(true);
    }
  });

  it('excludes the cached menu, the 404 shell and JSON', () => {
    for (const path of [
      '/estikana/menu/table-1',
      '/fofo/menu/t12',
      '/no/such/deep/path',
      '/a/b',
      '/api/pos/orders',
      '/api/public/order',
    ]) {
      expect(isNoncePath(path), path).toBe(false);
    }
  });
});
