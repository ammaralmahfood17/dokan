import { defineConfig } from '@playwright/test';

/**
 * E2E against the canonical production domain dokanstore.xyz (override with
 * E2E_BASE_URL) — the real money path. Tests create an isolated test store
 * (unique slug) and clean up after themselves.
 *
 * WORKERS. The default is 1 and that is deliberate, not a leftover: the public
 * routes are rate limited PER CLIENT IP, and the whole suite shares this
 * runner's single real IP. Measured against production on 2026-09-26:
 *   /api/public/order   20/min per <slug>:ip  +  30/min per ip
 *   /api/public/waiter   8/min per store      +  20/min per ip
 *   /api/public/bill     8/min per store
 * resilience alone posts ~37 to /api/public/order — more than the 30/min the
 * IP may spend — so it can throttle its own control calls and the failure
 * reads exactly like an app defect (seen twice: R5 and R8 seeding a 429).
 *
 * Raising E2E_WORKERS is therefore safe ONLY for a run that excludes the
 * budget-hungry specs, and they are budget-hungry per FILE, not per test:
 *   E2E_WORKERS=3 npx playwright test --grep-invert 'resilience|kitchen-ops'
 * A Vercel deployment cannot be given a different client IP — the platform
 * overwrites x-forwarded-for (verified: every rate_limits row after a spoofed
 * run was the runner's real IP), so IP-based isolation is not an option and
 * per-file budgeting is the only lever that does not touch production.
 */
export default defineConfig({
  testDir: './e2e',
  timeout: 90_000,
  expect: { timeout: 15_000 },
  retries: 0,
  workers: Number(process.env.E2E_WORKERS || 1),
  reporter: [['list']],
  use: {
    baseURL: process.env.E2E_BASE_URL || 'https://dokanstore.xyz',
    viewport: { width: 390, height: 844 },
    locale: 'ar-BH',
    trace: 'retain-on-failure',
    screenshot: 'only-on-failure',
  },
  projects: [
    // The functional suite stays on the single phone viewport (see the WORKERS
    // note above: it writes to production, so it is budgeted per file).
    // Responsive assertions live in their own project — mixing 6 viewports into
    // this one would multiply every fixture-creating spec by six.
    {
      name: 'chrome',
      testIgnore: /responsive\.spec\.ts/,
      use: { browserName: 'chromium', channel: process.env.PW_CHANNEL || 'chrome' },
    },
    {
      name: 'responsive',
      testMatch: /responsive\.spec\.ts/,
      use: { browserName: 'chromium', channel: process.env.PW_CHANNEL || 'chrome' },
    },
  ],
});
