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
      "script-src 'self' 'unsafe-eval' 'unsafe-inline' https://*.sentry.io https://challenges.cloudflare.com",
      "style-src 'self' 'unsafe-inline' https://fonts.googleapis.com",
      "img-src 'self' blob: data: https://*.supabase.co",
      "connect-src 'self' https://*.supabase.co wss://*.supabase.co https://sentry.io https://*.ingest.sentry.io",
      "font-src 'self' https://fonts.gstatic.com",
      "frame-ancestors 'none'",
      "base-uri 'self'",
      "form-action 'self'",
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
