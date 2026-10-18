/**
 * The Content-Security-Policy, in one place.
 *
 * Every page is rendered per request (root layout sets `dynamic = 'force-dynamic'`), so
 * `src/proxy.ts` can mint a nonce, put the policy on the REQUEST header (that is how
 * Next learns to stamp `nonce="…"` onto its own script tags) and on the RESPONSE header.
 * `script-src` therefore never needs `'unsafe-inline'` on an HTML response.
 *
 * The trade, accepted deliberately: a per-request render means no CDN-cached HTML. The
 * data reads stay cached (`unstable_cache`, project-tagged), so the cost is the render,
 * not the database. `/api/*` returns JSON and gets no CSP.
 *
 * Header values are built here so the proxy and the tests read the same string.
 */

/** Non-HTML responses (JSON) have no CSP scope. */
export function isNoncePath(pathname: string): boolean {
  return !pathname.startsWith('/api');
}

export interface CspOptions {
  /** The per-request nonce. Required: a policy without one would have to allow inline scripts. */
  nonce: string;
  /** Dev bundler needs `'unsafe-eval'` for eval sourcemaps; production does not. */
  dev?: boolean;
  /** `upgrade-insecure-requests` only when the app is really served over https. */
  https?: boolean;
}

export function buildCsp({ nonce, dev = false, https = true }: CspOptions): string {
  if (!nonce) {
    throw new Error('CSP requires a nonce — without one script-src would need unsafe-inline');
  }
  const evalSource = dev ? " 'unsafe-eval'" : '';

  // Sentry + Turnstile origins stay listed even though `'strict-dynamic'` makes
  // CSP3 browsers ignore host allowlists: they are the CSP2 fallback.
  const scriptSrc = `script-src 'self' 'nonce-${nonce}' 'strict-dynamic'${evalSource} https://*.sentry.io https://challenges.cloudflare.com`;

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
