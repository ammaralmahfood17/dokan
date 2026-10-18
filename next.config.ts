import type { NextConfig } from 'next';
import { withSentryConfig } from '@sentry/nextjs';

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
  // audit T1 #22: X-XSS-Protection removed. The header is obsolete - browsers dropped the XSS
  // auditor, and block mode has been a liability rather than a control for years - and keeping it
  // reads as "XSS is handled" when the actual controls are the CSP (src/lib/csp.ts, emitted by
  // src/proxy.ts) and React's escaping.
  // Dead security theatre is what makes the real posture hard to review. ci.yml now asserts its
  // ABSENCE, so it cannot creep back.
  // F-18: the Content-Security-Policy is NOT configured here any more. It lives in
  // `src/lib/csp.ts` and is emitted per request by `src/proxy.ts`, because the app
  // needs two policies: dynamic routes (`/dashboard/*`, `/super-admin/*`) get a
  // strict nonce policy, while prerendered/ISR pages keep `'unsafe-inline'` (a
  // nonce cannot be attached to HTML rendered at build time, and ISR slugs are
  // rendered per tenant at runtime). Declaring a second CSP here would send TWO
  // policies on the nonce routes — browsers enforce both, and the looser one would
  // defeat the strict one. Do not re-add it.
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
