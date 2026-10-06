import { defineConfig } from '@playwright/test';

/**
 * axe config — 2026-10 audit, Wave 3 T10.
 *
 * The main playwright.config.ts pins `channel: 'chrome'` (the SYSTEM Google Chrome), which is
 * right for the e2e suite on the operator's machine but makes a CI gate impossible without
 * installing Chrome into the runner. Accessibility auditing needs none of Chrome's specific
 * behaviour, so this config uses Playwright's bundled chromium and touches nothing else.
 *
 *   npm run a11y                                    # E2E_BASE_URL decides the target
 *   E2E_BASE_URL=http://localhost:3000 npm run a11y
 */
export default defineConfig({
  testDir: './e2e',
  testMatch: /a11y\.spec\.ts/,
  fullyParallel: false,
  workers: 1,
  reporter: [['list']],
  use: {
    baseURL: process.env.E2E_BASE_URL || 'https://dokanstore.xyz',
    browserName: 'chromium',
    // Plain headless uses Playwright's `chromium_headless_shell` artifact. That is the one
    // `npx playwright install chromium` fetches, and `channel: 'chromium'` (the full browser)
    // would need a second, larger download - which is why this config does NOT set a channel.
    trace: 'off',
  },
  projects: [{ name: 'chromium', use: { browserName: 'chromium' } }],
});
