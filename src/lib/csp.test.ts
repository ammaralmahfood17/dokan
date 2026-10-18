import { describe, expect, it } from 'vitest';
import { buildCsp, isNonceRoute } from './csp';

/** Parse a policy into directive → sources, so assertions read like the header. */
function directives(policy: string): Map<string, string[]> {
  return new Map(
    policy.split(';').map((part) => {
      const [name, ...values] = part.trim().split(/\s+/);
      return [name, values] as const;
    })
  );
}

describe('buildCsp — static policy (prerendered / ISR)', () => {
  const policy = buildCsp();
  const d = directives(policy);

  it('allows inline scripts, because build-time HTML cannot carry a nonce', () => {
    expect(d.get('script-src')).toContain("'unsafe-inline'");
    expect(d.get('script-src')?.some((s) => s.startsWith("'nonce-"))).toBe(false);
  });

  it('keeps the rest of the posture intact', () => {
    expect(d.get('default-src')).toEqual(["'self'"]);
    expect(d.get('frame-ancestors')).toEqual(["'none'"]);
    expect(d.get('object-src')).toEqual(["'none'"]);
    expect(d.get('base-uri')).toEqual(["'self'"]);
    expect(d.get('form-action')).toEqual(["'self'"]);
    expect(d.get('font-src')).toEqual(["'self'", 'data:']);
  });

  it('never ships unsafe-eval to production', () => {
    expect(d.get('script-src')).not.toContain("'unsafe-eval'");
    expect(directives(buildCsp({ dev: true })).get('script-src')).toContain("'unsafe-eval'");
  });

  it('emits upgrade-insecure-requests only for an https site', () => {
    expect(d.has('upgrade-insecure-requests')).toBe(true);
    expect(directives(buildCsp({ https: false })).has('upgrade-insecure-requests')).toBe(false);
  });
});

describe('buildCsp — strict policy (per-request nonce)', () => {
  const nonce = 'rAnd0m+/base64==';
  const d = directives(buildCsp({ nonce }));

  it('carries the nonce verbatim and drops unsafe-inline', () => {
    expect(d.get('script-src')).toContain(`'nonce-${nonce}'`);
    expect(d.get('script-src')).not.toContain("'unsafe-inline'");
  });

  it('adds strict-dynamic so chunks injected by the trusted runtime still load', () => {
    expect(d.get('script-src')).toContain("'strict-dynamic'");
  });

  it('still pins the named third-party origins for CSP2 browsers', () => {
    const scriptSrc = d.get('script-src') ?? [];
    expect(scriptSrc).toContain('https://*.sentry.io');
    expect(scriptSrc).toContain('https://challenges.cloudflare.com');
  });

  it('keeps every non-script guarantee identical to the static policy', () => {
    const staticDirectives = directives(buildCsp());
    for (const name of ['default-src', 'frame-ancestors', 'object-src', 'base-uri', 'form-action', 'connect-src', 'img-src', 'font-src', 'worker-src']) {
      expect(d.get(name), name).toEqual(staticDirectives.get(name));
    }
  });

  it('declares each directive exactly once', () => {
    const names = buildCsp({ nonce }).split(';').map((part) => part.trim().split(/\s+/)[0]);
    expect(new Set(names).size).toBe(names.length);
  });
});

describe('isNonceRoute', () => {
  it('covers the routes rendered per request', () => {
    for (const path of ['/dashboard', '/dashboard/orders', '/dashboard/pos', '/super-admin', '/super-admin/users']) {
      expect(isNonceRoute(path), path).toBe(true);
    }
  });

  it('leaves prerendered and ISR routes on the static policy', () => {
    for (const path of ['/', '/login', '/register', '/terms', '/onboarding', '/estikana', '/estikana/menu/table-1', '/dashboardx', '/super-adminn/x']) {
      expect(isNonceRoute(path), path).toBe(false);
    }
  });
});
