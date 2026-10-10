import { test, expect, type Page } from '@playwright/test';
import crypto from 'node:crypto';
import { admin, createTestUser, cleanupTestUser, E2E_BASE_URL, makeEmail } from './helpers';

/**
 * SMOKE SUITE — the "is production alive and can a customer actually order?" gate.
 *
 * Runs against the live deployment (E2E_BASE_URL, default https://dokanstore.xyz) in ONE
 * throwaway tenant it creates and deletes itself, so it is safe to run on demand and cheap on the
 * public rate limits (exactly ONE order is posted: /api/public/order allows 20/min per slug:ip).
 *
 * Four scenarios, in the order a real person meets them:
 *   1. /dashboard while signed out → lands on /login (and the API answers 3xx, never 200)
 *   2. public storefront → real content, dir="rtl", the browse link works
 *   3. menu → category, item, price in Arabic RTL
 *   4. cart → quantity stepper recalculates the subtotal → checkout reaches «تم استلام طلبك»
 *      without a 5xx, and the order EXISTS in the database afterwards
 *   5. hygiene — no console error, no page error, no failed request and no 4xx/5xx from our own
 *      origin or Supabase across all of the above (this is the "network + realtime health" check)
 *
 * NOTE ON ROUTE NAMING: this app's public routes are `/<projectSlug>` and
 * `/<projectSlug>/menu/<tableSlug>` — there is no `/s/<slug>/table/<id>` shape in Dokan.
 * Ordering requires the table's scan token (`?k=<tables.qrcode>`); without it the menu renders
 * browse-only («مسح الرمز» instead of «إتمام الطلب»), which is asserted in scenario 2.
 */
test.describe.configure({ mode: 'serial' });

const RUN = Date.now() % 1_000_000;
const slug = `e2e-smoke-${RUN}`;
const email = makeEmail();
/** tables.qrcode is GLOBALLY unique and 128-bit lowercase hex — never share one across fixtures. */
const TABLE_TOKEN = crypto.randomUUID().replace(/-/g, '');
const STORE_NAME = `متجر فحص ${RUN}`;
const CATEGORY = `قسم الفحص ${RUN}`;
const PRODUCT = `منتج الفحص ${RUN}`;
const PRICE = 0.5;
const PRICE_TEXT = '0.500 BHD';

let projectId = '';

/** Cross-test hygiene ledger: everything a browser complained about during the whole suite. */
const consoleErrors: string[] = [];
const pageErrors: string[] = [];
const failedRequests: string[] = [];
const badResponses: string[] = [];

function watch(page: Page) {
  page.on('console', (m) => {
    if (m.type() === 'error') consoleErrors.push(`${page.url()} :: ${m.text().slice(0, 200)}`);
  });
  page.on('pageerror', (e) => pageErrors.push(`${page.url()} :: ${e.message.slice(0, 200)}`));
  page.on('requestfailed', (r) => {
    // a cancelled request is normal navigation noise, not a defect
    const reason = r.failure()?.errorText || 'unknown';
    if (reason.includes('ERR_ABORTED')) return;
    failedRequests.push(`${r.method()} ${r.url().slice(0, 110)} :: ${reason}`);
  });
  page.on('response', (res) => {
    const url = res.url();
    const isOurs = url.startsWith(E2E_BASE_URL) || url.includes('.supabase.co');
    const isHtmlOrApi = /(\/api\/|\/rest\/v1\/|\/auth\/v1\/|\/menu\/|\/dashboard|\.html)/.test(url) || res.request().resourceType() === 'document';
    if (isOurs && isHtmlOrApi && res.status() >= 400) {
      badResponses.push(`${res.status()} ${res.request().method()} ${url.slice(0, 110)}`);
    }
  });
}

test.beforeAll(async () => {
  await cleanupTestUser(email);
  const user = await createTestUser(email);

  const { data: proj, error } = await admin
    .from('projects')
    .insert({ name: STORE_NAME, slug, currency: 'BHD', primary_color: '#4338CA', is_active: true })
    .select('id')
    .single();
  if (error || !proj) throw new Error(`seed project: ${error?.message ?? 'no row'}`);
  projectId = proj.id;

  await admin.from('staff_members').insert({ project_id: projectId, user_id: user.id, role: 'owner' });

  const { data: cat } = await admin
    .from('categories')
    .insert({ project_id: projectId, name: CATEGORY, sort_order: 1, is_active: true })
    .select('id')
    .single();

  const { data: prod, error: prodErr } = await admin
    .from('products')
    .insert({ project_id: projectId, category_id: cat!.id, name: PRODUCT, price: PRICE, is_available: true, sort_order: 1 })
    .select('id')
    .single();
  if (prodErr || !prod) throw new Error(`seed product: ${prodErr?.message ?? 'no row'}`);

  // ONE active table: the storefront must NOT redirect anywhere (owner decision 5 keeps the root
  // informational), so a redirect would be a regression this suite can see.
  await admin.from('tables').insert({
    project_id: projectId, number: 1, slug: 'table-1', is_active: true, qrcode: TABLE_TOKEN,
  });
});

test.afterAll(async () => {
  await cleanupTestUser(email);
});

test('1. /dashboard while unauthenticated redirects to /login', async ({ page, request }) => {
  // The HTTP contract first: a signed-out visitor must never get a 200 document for /dashboard.
  const res = await request.get('/dashboard', { maxRedirects: 0 });
  expect(res.status(), 'signed-out /dashboard must redirect').toBeGreaterThanOrEqual(300);
  expect(res.status()).toBeLessThan(400);
  expect(res.headers()['location'] || '', 'redirect target must be the login page').toContain('/login');

  // Then the human contract: the browser lands on a usable login form.
  watch(page);
  await page.goto('/dashboard');
  await page.waitForURL(/\/login/, { timeout: 30_000 });
  await expect(page.locator('input[type="password"]').first()).toBeVisible();
  await expect(page).toHaveTitle(/دكان/);
});

test('2. public storefront renders RTL with real content, and its browse link works', async ({ page }) => {
  watch(page);
  const res = await page.goto(`/${slug}`);
  expect(res?.status(), 'the seeded store must be publicly reachable').toBe(200);

  expect(await page.getAttribute('html', 'dir')).toBe('rtl');
  await expect(page.locator('h1').first()).toContainText(STORE_NAME);
  // Informational root (no silent redirect to the menu): tells the customer to scan the QR.
  await expect(page.getByText('امسح رمز QR')).toBeVisible();
  expect(new URL(page.url()).pathname, 'the storefront root must not redirect').toBe(`/${slug}`);

  const browse = page.getByRole('link', { name: 'تصفّح القائمة' });
  await expect(browse).toBeVisible();
  await browse.click();
  await page.waitForURL(new RegExp(`/${slug}/menu/table-1$`));
  // Browsing without a token is allowed but ordering is not. The confirm CTA («إتمام الطلب» /
  // «مسح الرمز») lives in the CART BAR, which only renders once the cart has items — so the
  // assertion for a token-less visit is the repo's own: the CTA does not exist.
  await expect(page.getByRole('heading', { name: CATEGORY }).first()).toBeVisible({ timeout: 20_000 });
  await expect(page.getByRole('button').filter({ hasText: 'إتمام الطلب' })).toHaveCount(0);
  await expect(page.getByRole('button', { name: 'تأكيد الطلب', exact: true })).toHaveCount(0);
});

test('3. menu renders the category, the item and its price in Arabic RTL', async ({ page }) => {
  watch(page);
  const res = await page.goto(`/${slug}/menu/table-1?k=${TABLE_TOKEN}`);
  expect(res?.status()).toBe(200);

  expect(await page.getAttribute('html', 'dir')).toBe('rtl');
  await expect(page.getByText(STORE_NAME).first()).toBeVisible();
  await expect(page.getByRole('heading', { name: CATEGORY }).first()).toBeVisible();
  await expect(page.getByText(PRODUCT).first()).toBeVisible();
  await expect(page.getByText(PRICE_TEXT).first()).toBeVisible();
});

test('4. cart: add → quantity up → subtotal recomputes → down', async ({ page }) => {
  watch(page);
  await page.goto(`/${slug}/menu/table-1?k=${TABLE_TOKEN}`);

  const add = page.getByRole('button', { name: `إضافة ${PRODUCT} إلى السلة` }).first();
  await add.scrollIntoViewIfNeeded();
  await add.click();

  // The cart sheet opens on the first add and shows the line + the subtotal.
  await expect(page.getByText(PRICE_TEXT).first()).toBeVisible({ timeout: 20_000 });

  await page.getByRole('button', { name: 'زيادة الكمية' }).first().click();
  await expect(page.getByText('1.000 BHD').first(), 'subtotal must double with quantity 2').toBeVisible({
    timeout: 20_000,
  });

  await page.getByRole('button', { name: 'إنقاص الكمية' }).first().click();
  await expect(page.getByText(PRICE_TEXT).first(), 'subtotal must fall back to one unit').toBeVisible({
    timeout: 20_000,
  });
});

test('5. checkout submits, reaches the success state, and the order exists in the DB', async ({ page }) => {
  watch(page);
  await page.goto(`/${slug}/menu/table-1?k=${TABLE_TOKEN}`);

  const add = page.getByRole('button', { name: `إضافة ${PRODUCT} إلى السلة` }).first();
  await add.scrollIntoViewIfNeeded();
  await add.click();

  const orderPost = page.waitForResponse(
    (r) => r.url().includes('/api/public/order') && r.request().method() === 'POST',
    { timeout: 30_000 }
  );
  await page.getByRole('button', { name: 'تأكيد الطلب' }).click();
  const res = await orderPost;
  expect(res.status(), `order POST must not fail: ${await res.text().catch(() => '')}`).toBe(200);

  await expect(page.getByText('تم استلام طلبك')).toBeVisible({ timeout: 30_000 });

  // The database is the source of truth: exactly one order, priced by the server.
  const { data: orders } = await admin
    .from('orders')
    .select('id, status, total_amount')
    .eq('project_id', projectId);
  expect(orders?.length, 'exactly one order must exist for this store').toBe(1);
  expect(orders![0].status).toBe('pending');
  expect(Number(orders![0].total_amount)).toBeCloseTo(PRICE, 3);
});

test('6. hygiene: no console errors, page errors, failed requests or 4xx/5xx during the flow', async () => {
  // Reported together so a failure names every offending line at once.
  expect(consoleErrors, `console errors:\n${consoleErrors.join('\n')}`).toEqual([]);
  expect(pageErrors, `uncaught page errors:\n${pageErrors.join('\n')}`).toEqual([]);
  expect(failedRequests, `failed requests (chunk load / network):\n${failedRequests.join('\n')}`).toEqual([]);
  expect(badResponses, `4xx/5xx from our origin or Supabase:\n${badResponses.join('\n')}`).toEqual([]);
});
