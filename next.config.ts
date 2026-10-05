import type { NextConfig } from 'next';
import { withSentryConfig } from '@sentry/nextjs';

/** Dev needs the bundler's eval sourcemaps; production does not. */
const isDev = process.env.NODE_ENV !== 'production';

/** Emit `upgrade-insecure-requests` only when the app is actually served over
 *  https. Keying it on NODE_ENV would break LOCAL verification: `next start`
 *  runs with NODE_ENV=production on http://localhost, and the browser would then
 *  upgrade every same-origin subresource to https and fail to load them. */
const siteIsHttps = (process.env.NEXT_PUBLIC_SITE_URL || '').startsWith('https://');

const securityHeaders = [
  { key: 'X-Frame-Options', value: 'SAMEORIGIN' },
  { key: 'X-Content-Type-Options', value: 'nosniff' },
  { key: 'Referrer-Policy', value: 'strict-origin-when-cross-origin' },
  {
    key: 'Strict-Transport-Security',
    value: 'max-age=31536000; includeSubDomains; preload',
  },
  {
    key: 'Permissions-Policy',
    value: 'camera=(), microphone=(), geolocation=(), interest-cohort=()',
  },
  { key: 'X-XSS-Protection', value: '1; mode=block' },
  // F1: Content-Security-Policy. Next.js needs 'unsafe-inline'/'unsafe-eval'
  // for its runtime scripts; Google Fonts (Cairo via next/font) needs
  // fonts.googleapis.com (style) + fonts.gstatic.com (font data); Supabase
  // is the API/WS origin; Sentry for error reporting. frame-ancestors 'none'
  // hardens against clickjacking on top of X-Frame-Options.
  {
    key: 'Content-Security-Policy',
    value: [
      "default-src 'self'",
      // 'unsafe-inline' is unavoidable until Next can be given a per-request nonce
      // (deferred: a nonce makes previously-static pages uncacheable, which costs the
      // landing page's LCP). 'unsafe-eval' is only needed by the DEV bundler's eval
      // sourcemaps, so production does not ship it any more.
      // challenges.cloudflare.com serves the Turnstile widget script (owner decision 7).
      `script-src 'self' 'unsafe-inline'${isDev ? " 'unsafe-eval'" : ''} https://*.sentry.io https://challenges.cloudflare.com`,
      // next/font self-hosts Cairo — the old fonts.googleapis.com allowance was dead.
      "style-src 'self' 'unsafe-inline'",
      "img-src 'self' blob: data: https://*.supabase.co",
      // SENTRY FIX (verified by the CSP census, 2026-10-05): the DSN host is
      // region-scoped — o4511834824638464.ingest.us.sentry.io — and a CSP host
      // wildcard must match the WHOLE suffix, so "*.ingest.sentry.io" does NOT match
      // "…ingest.us.sentry.io". Every browser event from every merchant was being
      // refused by our own policy (server events were unaffected, which is why the
      // health check's browserMonitoring flag looked fine). "*.sentry.io" covers all
      // regions.
      "connect-src 'self' https://*.supabase.co wss://*.supabase.co https://*.sentry.io https://challenges.cloudflare.com",
      // No third-party font origin: fonts.gstatic.com was dead too.
      "font-src 'self'",
      // Coverage the policy never declared: these fell back to default-src, which
      // happened to be 'self' — declaring them is explicit and blocks <object>/<embed>
      // outright. blob: on worker-src is required by Sentry's Replay compression worker.
      "object-src 'none'",
      "worker-src 'self' blob:",
      "manifest-src 'self'",
      // Turnstile renders an iframe on this origin. Narrowest allowance that still works —
      // 'none' silently broke the widget (the challenge never appeared, and the server then
      // refused signup for a missing token).
      "frame-src https://challenges.cloudflare.com",
      "frame-ancestors 'none'",
      "base-uri 'self'",
      "form-action 'self'",
      // only when the site is really served over https (see siteIsHttps above).
      ...(siteIsHttps ? ['upgrade-insecure-requests'] : []),
    ].join('; '),
  },
];

const nextConfig: NextConfig = {
  reactStrictMode: true,
  // A Sentry DSN is intentionally public: the browser SDK must ship it to send
  // events. Vercel already stores SENTRY_DSN for the server, so expose the same
  // project DSN at build time when a dedicated public value is not configured.
  // Authentication still uses SENTRY_AUTH_TOKEN, which remains server-only.
  env: {
    NEXT_PUBLIC_SENTRY_DSN:
      process.env.NEXT_PUBLIC_SENTRY_DSN || process.env.SENTRY_DSN || '',
  },
  images: {
    remotePatterns: [
      {
        protocol: 'https',
        hostname: '*.supabase.co',
      },
    ],
  },
  async redirects() {
    // A2/UX-report: www + apex were duplicate content. Env-driven (never
    // hardcode a domain — repo contract): redirect www.<apex> → apex, 308.
    const siteUrl = process.env.NEXT_PUBLIC_SITE_URL;
    if (!siteUrl) return [];
    let host: string;
    try {
      host = new URL(siteUrl).hostname;
    } catch {
      return [];
    }
    if (host === 'localhost') return [];
    return [
      {
        source: '/:path*',
        has: [{ type: 'host', value: `www.${host}` }],
        destination: `https://${host}/:path*`,
        permanent: true,
      },
    ];
  },
  async headers() {
    return [
      {
        source: '/(.*)',
        headers: securityHeaders,
      },
      // A2: <project>.vercel.app serves the same app (e2e target) — keep it
      // out of search engines so the canonical domain is the only one indexed.
      {
        source: '/(.*)',
        has: [{ type: 'host', value: '(?<host>.+)\\.vercel\\.app' }],
        headers: [{ key: 'X-Robots-Tag', value: 'noindex, nofollow' }],
      },
      // A2: the customer menu URL carries the table's scan token in `?k=`. A Referer header
      // would hand that credential to every third party the page later talks to (a font CDN,
      // an outbound link the customer taps). The whole customer-facing subtree therefore
      // opts out of referrers. Declared LAST so it overrides the global policy above.
      {
        source: '/:projectSlug/menu/:path*',
        headers: [{ key: 'Referrer-Policy', value: 'no-referrer' }],
      },
    ];
  },
};

// Sentry + source maps.
//
// Before 2026-09-26 no `authToken` was set, so the SDK built the maps and then
// silently dropped them: production stack traces were minified frame numbers
// (app/.../page.js:1:48213) with no file or line. Uploading requires all three
// of SENTRY_AUTH_TOKEN + SENTRY_ORG + SENTRY_PROJECT — the SDK passes the
// `authToken` option straight through to sentry-cli, and without it the upload
// has nowhere to send the maps.
//
// The three are read from the environment, never hardcoded, so the token stays
// in Vercel's env and out of git. SENTRY_DSN alone is NOT enough.
export default withSentryConfig(nextConfig, {
  org: process.env.SENTRY_ORG,
  project: process.env.SENTRY_PROJECT,
  authToken: process.env.SENTRY_AUTH_TOKEN,
  // `next build` is not the after-production-compile hook, so upload runs.
  sourcemaps: {
    // Maps are uploaded to Sentry then deleted from .next, so no bundle ever
    // serves a `//# sourceMappingURL` back to a browser — that would let anyone
    // read the original source in devtools.
    deleteSourcemapsAfterUpload: true,
  },
  // Never let a Sentry outage or a missing token fail the production build.
  errorHandler: (error) => {
    console.warn('[sentry] source map upload failed:', error);
  },
  // A failed upload is what makes stack traces useless, and `silent: true`
  // swallowed it: the build printed nothing, exited 0, and the only symptom was
  // leftover .map files nobody was looking at. Keep the plugin talking on every
  // machine so a regression shows up in the build log instead of a week later in
  // Sentry. `SENTRY_LOG_LEVEL` can still lower or raise the detail level, and the
  // errorHandler above keeps an actual failure non-fatal for the build.
  silent: false,
  telemetry: false,
  widenClientFileUpload: true,
});
