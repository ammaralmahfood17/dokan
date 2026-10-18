/**
 * The Content-Security-Policy, in one place.
 *
 * There are two policies because this app serves two kinds of HTML, and the
 * difference is a hard constraint of Next.js, not a preference:
 *
 *  • PRERENDERED / ISR pages (`/`, `/login`, `/terms`, `/[projectSlug]`,
 *    `/[projectSlug]/menu/[tableSlug]`, …) are rendered at build time (or on
 *    demand and then cached) and served from the CDN. A nonce cannot be attached
 *    to HTML that does not exist at request time. Build-time hashes cannot work
 *    either: every page carries a DIFFERENT inline RSC flight payload, and the
 *    tenant routes are rendered per slug at runtime. These pages therefore keep
 *    `'unsafe-inline'`.
 *
 *  • DYNAMIC pages (`/dashboard/*`, `/super-admin/*`) are rendered per request,
 *    so `src/proxy.ts` mints a nonce, puts the CSP on the REQUEST header (that is
 *    how Next learns to stamp `nonce="…"` onto every script tag) and on the
 *    RESPONSE header. These get a strict policy: no `'unsafe-inline'`, and
 *    `'strict-dynamic'` so chunks injected by the already-trusted Next runtime
 *    still load.
 *
 * Header values are built here so the proxy and the tests read the same string.
 */

/** Route prefixes rendered per request — a nonce is safe (and strict CSP possible). */
export const NONCE_ROUTE_PREFIXES = ['/dashboard', '/super-admin'] as const;

export function isNonceRoute(pathname: string): boolean {
  return NONCE_ROUTE_PREFIXES.some(
    (prefix) => pathname === prefix || pathname.startsWith(`${prefix}/`)
  );
}

export interface CspOptions {
  /** Per-request nonce. Its presence switches the policy from static to strict. */
  nonce?: string;
  /** Dev bundler needs `'unsafe-eval'` for eval sourcemaps; production does not. */
  dev?: boolean;
  /** `upgrade-insecure-requests` only when the app is really served over https. */
  https?: boolean;
}

export function buildCsp({ nonce, dev = false, https = true }: CspOptions = {}): string {
  const evalSource = dev ? " 'unsafe-eval'" : '';

  // Sentry + Turnstile origins stay listed even though `'strict-dynamic'` makes
  // CSP3 browsers ignore host allowlists: they are the CSP2 fallback.
  const scriptSrc = nonce
    ? `script-src 'self' 'nonce-${nonce}' 'strict-dynamic'${evalSource} https://*.sentry.io https://challenges.cloudflare.com`
    : `script-src 'self' 'unsafe-inline'${evalSource} https://*.sentry.io https://challenges.cloudflare.com`;

  return [
    "default-src 'self'",
    scriptSrc,
    // React style props are inline by design; the audit item was script-src.
    "style-src 'self' 'unsafe-inline'",
    "img-src 'self' blob: data: https://*.supabase.co",
    // The Sentry DSN host is region-scoped (…ingest.us.sentry.io), so the
    // wildcard must be *.sentry.io, not *.ingest.sentry.io.
    "connect-src 'self' https://*.supabase.co wss://*.supabase.co https://*.sentry.io https://challenges.cloudflare.com",
    // data: is REQUIRED: the خط ثمانية faces ship inside the stylesheet as data: URIs.
    "font-src 'self' data:",
    "object-src 'none'",
    "worker-src 'self' blob:",
    "manifest-src 'self'",
    'frame-src https://challenges.cloudflare.com',
    "frame-ancestors 'none'",
    "base-uri 'self'",
    "form-action 'self'",
    ...(https ? ['upgrade-insecure-requests'] : []),
  ].join('; ');
}

/** Same rule next.config.ts used: https only when the site URL really is https. */
export function siteIsHttps(): boolean {
  return (process.env.NEXT_PUBLIC_SITE_URL || '').startsWith('https://');
}
