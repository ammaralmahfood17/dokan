import { test, expect, type Page, type APIRequestContext } from '@playwright/test';

/**
 * D3 (owner decision 2026-10-06) — the table token is not part of the render.
 *
 * Two properties, each asserted rather than reasoned about:
 *
 *  1. **The HTML does not depend on the token.** It used to be byte-identical because the
 *     page was cached; since F-18 every page renders per request and carries a fresh CSP
 *     nonce, so the comparison normalises the nonce and asserts everything else is equal.
 *  2. **The token never appears in the HTML.** `tables.qrcode` must not reach logs, Sentry,
 *     analytics, Referer headers - or the page source. The proxy answers `?k=` with a 307 to
 *     `#k=` (fragments are never sent upstream), so the render never receives it.
 *
 * The ordering gate is still decided client-side from the URL, and the server still enforces
 * it on POST.
 */
const BASE = process.env.E2E_BASE_URL || 'https://dokanstore.xyz';
const STRICT_BASE = process.env.E2E_BASE_URL_STRICT; // a server started with REQUIRE_TABLE_TOKEN=true
const MENU = process.env.E2E_MENU_PATH || '/estikana/menu/table-1';

// Fetch the RAW response, not `page.content()`: the live DOM is post-hydration and would compare
// client state, not what the server sent.
const TOKEN = '0123456789abcdef0123456789abcdef';

/**
 * Fetch a raw response and blank out the only things that legitimately differ between two
 * renders: the CSP nonce (it appears in attributes AND inside the escaped Flight payload, so
 * it is replaced by value) and Sentry's per-request trace ids.
 */
async function normalisedRaw(request: APIRequestContext, url: string): Promise<string> {
  const res = await request.get(url);
  const body = await res.text();
  const csp = res.headers()['content-security-policy'] ?? '';
  const nonce = csp.match(/'nonce-([^']+)'/)?.[1];
  return (nonce ? body.split(nonce).join('<nonce>') : body)
    .replace(/(<meta name="sentry-trace" content=")[^"]*(")/g, '$1<normalised>$2')
    .replace(/(<meta name="baggage" content=")[^"]*(")/g, '$1<normalised>$2');
}

async function html(page: Page, url: string): Promise<string> {
  await page.goto(url, { waitUntil: 'load' });
  await page.waitForFunction(() => document.styleSheets.length > 0);
  return page.content();
}

test('the menu HTML does not depend on the token', async ({ request }) => {
  const without = await normalisedRaw(request, `${BASE}${MENU}`);
  const withToken = await normalisedRaw(request, `${BASE}${MENU}?k=${TOKEN}`);
  expect(
    withToken === without,
    'the token must not change the render: only the nonce and Sentry ids may differ'
  ).toBe(true);
});

test('the table token never appears in the served HTML', async ({ request }) => {
  const res = await request.get(`${BASE}${MENU}?k=${TOKEN}`);
  const body = await res.text();
  expect(body).not.toContain(TOKEN);
  expect(body, 'no ?k= in the markup').not.toContain('?k=');
});

test('the cached menu keeps the static policy (the documented F-18 exception)', async ({ request }) => {
  const res = await request.get(`${BASE}${MENU}`);
  const headers = await res.headersArray();
  const cspHeaders = headers.filter((h) => h.name.toLowerCase() === 'content-security-policy');
  expect(cspHeaders.length, 'exactly one CSP header — two would be enforced together').toBe(1);
  const csp = cspHeaders[0]!.value;
  expect(csp).toContain("script-src 'self' 'unsafe-inline'");
  expect(csp).not.toContain("'nonce-");
  expect(csp).toContain("frame-ancestors 'none'");
});

test('with REQUIRE_TABLE_TOKEN=true the gate follows the URL, client-side', async ({ page }) => {
  // NOTE: E2E_BASE_URL_STRICT must be a target rendered with the flag TRUE and must NOT share an ISR
  // cache directory with a flag-false server: the cached HTML carries whichever value was rendered,
  // which is how the first run of this test failed (two `next start` processes share .next/cache).
  // A `next dev` server with REQUIRE_TABLE_TOKEN=true is the easy target.
  test.skip(!STRICT_BASE, 'set E2E_BASE_URL_STRICT to a server rendered with REQUIRE_TABLE_TOKEN=true');

  // The cart bar only exists once something is in the cart, so add one product first. Products
  // with a required option group open a picker (size), and the confirm button stays disabled
  // until one is chosen — the old version clicked once and waited for a bar that never appeared.
  const addFirstProduct = async () => {
    await page.getByRole('button', { name: /إضافة .* إلى السلة/ }).first().click();
    const dialog = page.locator('[role="dialog"]');
    if (await dialog.count()) {
      const size = dialog.getByRole('radio').first();
      // the option list scrolls inside a bottom sheet; a force click still refuses an
      // element the browser reports as outside the viewport, so dispatch it directly
      if (await size.count()) await size.evaluate((el) => (el as HTMLElement).click());
      const confirm = dialog.getByRole('button', { name: 'أضف إلى السلة', exact: true });
      if (await confirm.count()) {
        await confirm.scrollIntoViewIfNeeded();
        await confirm.click({ force: true });
      }
    }
    await page.waitForTimeout(400);
  };

  await html(page, `${STRICT_BASE}${MENU}`);
  await expect(page.getByRole('button', { name: /إضافة .* إلى السلة/ }).first()).toBeVisible();
  await addFirstProduct();
  await expect(page.getByText('مسح الرمز').first()).toBeVisible();

  await html(page, `${STRICT_BASE}${MENU}?k=anything-at-all`);
  await addFirstProduct();
  await expect(page.getByText('إتمام الطلب').first()).toBeVisible();
});
