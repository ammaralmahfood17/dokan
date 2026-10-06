import { test, expect, type Page } from '@playwright/test';

/**
 * Owner decision D3 (2026-10-06) — the public menu is cached again, and the table token is not part
 * of the render.
 *
 * Three properties, each asserted rather than reasoned about:
 *
 *  1. **The HTML is identical with and without `?k=`.** That is what makes the page cacheable at
 *     all; if the token reached the server render, the cache would be keyed by a secret and a
 *     cached response could leak or serve the wrong ordering state.
 *  2. **The token never appears in the HTML.** `tables.qrcode` must not reach logs, Sentry,
 *     analytics, Referer headers - or the page source.
 *  3. **The ordering gate is decided client-side from the URL, and the server still enforces it.**
 *     With `REQUIRE_TABLE_TOKEN=true` the CTA reads "مسح الرمز" without a token and "إتمام الطلب"
 *     with one; enforcement on POST is covered by the route's own tests and the smoke script.
 *
 * Runs under `playwright.a11y.config.ts` because that is the config with the bundled browser (the
 * main config pins `channel: 'chrome'`); the name ends in `.a11y.spec.ts` for the same reason.
 */
const BASE = process.env.E2E_BASE_URL || 'https://dokanstore.xyz';
const STRICT_BASE = process.env.E2E_BASE_URL_STRICT; // a server started with REQUIRE_TABLE_TOKEN=true
const MENU = process.env.E2E_MENU_PATH || '/estikana/menu/table-1';

async function html(page: Page, url: string): Promise<string> {
  await page.goto(url, { waitUntil: 'load' });
  await page.waitForFunction(() => document.styleSheets.length > 0);
  return page.content();
}

test('the menu HTML is byte-identical with and without ?k=', async ({ page }) => {
  const without = await html(page, `${BASE}${MENU}`);
  const withToken = await html(page, `${BASE}${MENU}?k=0123456789abcdef0123456789abcdef`);
  expect(
    withToken === without,
    'the cached HTML must not depend on the token: identical bytes are the point of D3'
  ).toBe(true);
});

test('the table token never appears in the served HTML', async ({ page }) => {
  const body = await html(page, `${BASE}${MENU}?k=0123456789abcdef0123456789abcdef`);
  expect(body).not.toContain('0123456789abcdef0123456789abcdef');
  expect(body, 'no ?k= in the markup').not.toContain('?k=');
});

test('with REQUIRE_TABLE_TOKEN=true the gate follows the URL, client-side', async ({ page }) => {
  test.skip(!STRICT_BASE, 'set E2E_BASE_URL_STRICT to a server with REQUIRE_TABLE_TOKEN=true');
  // the cart bar only exists once something is in the cart, so add one product first
  const add = page.getByRole('button', { name: /إضافة .* إلى السلة/ }).first();
  await html(page, `${STRICT_BASE}${MENU}`);
  await expect(page.getByRole('button', { name: /إضافة .* إلى السلة/ }).first()).toBeVisible();
  await page.getByRole('button', { name: /إضافة .* إلى السلة/ }).first().click();
  await expect(page.getByText('مسح الرمز').first()).toBeVisible();

  await html(page, `${STRICT_BASE}${MENU}?k=anything-at-all`);
  await page.getByRole('button', { name: /إضافة .* إلى السلة/ }).first().click();
  await expect(page.getByText('إتمام الطلب').first()).toBeVisible();
  void add;
});
