/**
 * The Content-Security-Policy, in one place.
 *
 * Almost every page renders per request (root layout sets `dynamic = 'force-dynamic'`), so
 * `src/proxy.ts` can mint a nonce, put the policy on the REQUEST header (that is how Next
 * learns to stamp `nonce="…"` onto its own script tags) and on the RESPONSE header.
 *
 * The ONE exception is the customer menu (`/…/menu/…`): it stays `force-static` so every QR
 * scan is served from the CDN — measured, the per-request render cost 0.6-0.9 s on the
 * ordering flow, and that is the page customers hit at the table. A build-time page cannot
 * carry a nonce, so it gets the static policy with `'unsafe-inline'`. Its content is
 * React-escaped tenant data and the token never reaches the render (see the D3 note in the
 * menu page), so the exposure is the framework's own inline bootstrap.
 *
 * Header values are built here so the proxy and the tests read the same string.
 */

/** Non-HTML responses (JSON) have no CSP scope. */
export function isNoncePath(pathname: string): boolean {
  return !pathname.startsWith('/api');
}

/** The cached customer menu — the only route on the static policy. */
export function isStaticCspPath(pathname: string): boolean {
  return /^\/[^/]+\/menu\/[^/]+\/?$/.test(pathname);
}

export interface CspOptions {
  /** The per-request nonce. Required: a policy without one would have to allow inline scripts. */
  nonce: string;
  /** Dev bundler needs `'unsafe-eval'` for eval sourcemaps; production does not. */
  dev?: boolean;
  /** `upgrade-insecure-requests` only when the app is really served over https. */
  https?: boolean;
}

/** Shared directives; only `script-src` differs between the two policies. */
function assemble(scriptSrc: string, https: boolean): string {
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

/** Sentry + Turnstile origins stay listed for CSP2 browsers (`strict-dynamic` hides them in CSP3). */
const THIRD_PARTY = 'https://*.sentry.io https://challenges.cloudflare.com';

export function buildCsp({ nonce, dev = false, https = true }: CspOptions): string {
  if (!nonce) {
    throw new Error('CSP requires a nonce — without one script-src would need unsafe-inline');
  }
  const evalSource = dev ? " 'unsafe-eval'" : '';
  return assemble(
    `script-src 'self' 'nonce-${nonce}' 'strict-dynamic'${evalSource} ${THIRD_PARTY}`,
    https
  );
}

/**
 * The static policy — cached menu only. Kept a separate, named function so the one place that
 * allows inline scripts is explicit and greppable, never a fallback branch of buildCsp().
 */
export function buildStaticCsp({ dev = false, https = true }: Omit<CspOptions, 'nonce'> = {}): string {
  const evalSource = dev ? " 'unsafe-eval'" : '';
  return assemble(`script-src 'self' 'unsafe-inline'${evalSource} ${THIRD_PARTY}`, https);
}

/** Same rule next.config.ts used: https only when the site URL really is https. */
export function siteIsHttps(): boolean {
  return (process.env.NEXT_PUBLIC_SITE_URL || '').startsWith('https://');
}
