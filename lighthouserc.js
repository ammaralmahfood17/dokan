/**
 * Lighthouse CI — production Core Web Vitals watch (Wave 0, 2026-10-22).
 *
 * WHAT THIS IS: a nightly + manual lab measurement of the four public routes a
 * customer or merchant actually lands on, under Lighthouse's mobile emulation —
 * 4× CPU, 1.6 Mbps, 150 ms RTT, 360×800. That profile is the "$150 Android on
 * Gulf 4G" target in the development plan, and it is deliberately harsher than
 * a desktop run.
 *
 * WHY IT TARGETS PRODUCTION, NOT THE PR: the routes need live tenant data
 * (`/estikana`, the QR menu) and a `next start` server. A PR-time run would
 * either measure a placeholder build or need a seeded database — noise that
 * teaches the team to ignore the check. This job fails visibly on a regression
 * and opens a task; the PR-blocking lab gate over a local build lands in Wave 4
 * together with the seeded staging server.
 *
 * THRESHOLDS: the 2500 ms target, enforced since Wave 4 (2026-10-22).
 * Baseline before Wave 4 was 2627–2862 ms (single cold run each); after it,
 * medians of two runs: / 1656, /login 1535, /estikana 1402, menu 1902 ms —
 * 2500 keeps ~31% headroom over the slowest route. The one change with a
 * structural proof is the menu: its products used to sit in a hidden streamed
 * segment (bodyText 16 chars at DOMContentLoaded); after removing loading.tsx
 * they are in the initial HTML (1104 chars, zero hidden segments). The landing
 * and login numbers moved without a code change, so treat them as run-condition
 * variance, not as a claimed optimisation.
 * TBT is a warning: it is an INP proxy, and real INP comes from `web_vitals`
 * field data via `scripts/cwv-report.mjs`.
 */
const base = process.env.LH_BASE_URL || 'https://dokanstore.xyz';
const runs = Number(process.env.LH_RUNS || 3);

module.exports = {
  ci: {
    collect: {
      url: [
        `${base}/`,
        `${base}/login`,
        `${base}/estikana`,
        `${base}/estikana/menu/table-1`,
      ],
      numberOfRuns: runs,
      settings: {
        formFactor: 'mobile',
        screenEmulation: {
          mobile: true,
          width: 360,
          height: 800,
          deviceScaleFactor: 2,
          disabled: false,
        },
        throttlingMethod: 'simulate',
        onlyCategories: ['performance', 'accessibility', 'best-practices', 'seo'],
        // The QR menu is served from the CDN with `x-vercel-cache: HIT`; HTTP/2
        // negotiation is Vercel's, not ours, and would only add variance.
        skipAudits: ['uses-http2'],
      },
    },
    assert: {
      assertions: {
        'largest-contentful-paint': ['error', { maxNumericValue: 2500 }],
        'cumulative-layout-shift': ['error', { maxNumericValue: 0.05 }],
        'total-blocking-time': ['warn', { maxNumericValue: 600 }],
        'total-byte-weight': ['warn', { maxNumericValue: 600000 }],
        'categories:accessibility': ['error', { minScore: 0.9 }],
      },
    },
    upload: {
      target: 'temporary-public-storage',
    },
  },
};
