import { test, expect } from '@playwright/test';
import { admin, createTestUser, cleanupTestUser, E2E_BASE_URL, makeEmail } from './helpers';

/**
 * Storefront root page — public gateway for merchants to share their store.
 *
 * UPDATED 2026-10-10 (audit `a8007a5`), three assertions that no longer matched production:
 *
 *  1. The root NO LONGER redirects to a single table's menu — owner decision 5 (2026-10-06)
 *     removed that shortcut so the customer learns that ordering needs the physical QR. The old
 *     test waited for `/…/menu/table-1`, which the page has not done since.
 *  2. An unknown slug NO LONGER returns 404. The route is `force-static` (it is what makes the CDN
 *     cache the storefront: measured 1.9s MISS → 0.22s HIT), and inside a forced-static route Next
 *     SWALLOWS `notFound()`. An unknown slug therefore renders the graceful
 *     `<Unavailable kind="store" />` page with a 200. Assert the MESSAGE — that is what the
 *     customer gets — and keep asserting that no menu/ordering surface is reachable.
 *  3. `tables.qrcode` is GLOBALLY unique, so the fixture must not use the old shared `'x'`.
 *
 * Read-only tests still must not depend on mutable shared fixtures: everything below runs against a
 * store THIS FILE OWNS.
 */
import crypto from 'node:crypto';

const RUN = Date.now() % 1_000_000;
const slug = `e2e-storefront-${RUN}`;
const userEmail = makeEmail();
const TABLE_TOKEN = crypto.randomUUID().replace(/-/g, '');
let projectId = '';

const UNAVAILABLE_COPY = 'هذا المتجر غير متاح حالياً';

test.describe.configure({ mode: 'serial' });

test.describe('Storefront root page', () => {
  test.beforeAll(async () => {
    await cleanupTestUser(userEmail);
    const user = await createTestUser(userEmail);
    const { data: proj, error } = await admin
      .from('projects')
      .insert({ name: 'Storefront Test', slug, currency: 'BHD', primary_color: '#4338CA', is_active: true })
      .select('id')
      .single();
    if (error || !proj) throw new Error(`create project: ${error?.message ?? 'no row'}`);
    projectId = proj.id;
    await admin.from('staff_members').insert({ project_id: projectId, user_id: user.id, role: 'owner' });
    await admin
      .from('tables')
      .insert({ project_id: projectId, number: 1, slug: 'table-1', is_active: true, qrcode: TABLE_TOKEN });
  });

  test.afterAll(async () => {
    await cleanupTestUser(userEmail);
  });

  test('a single-table store stays on its root and offers ONE browse link', async ({ page }) => {
    const res = await page.goto(`${E2E_BASE_URL}/${slug}`);
    expect(res?.status(), 'the seeded store must be publicly reachable').toBe(200);

    // No silent redirect: the URL must still be the store root.
    expect(new URL(page.url()).pathname).toBe(`/${slug}`);
    await expect(page.getByText('امسح رمز QR')).toBeVisible();

    const browse = page.getByRole('link', { name: 'تصفّح القائمة' });
    await expect(browse).toHaveAttribute('href', `/${slug}/menu/table-1`);
    await browse.click();
    await page.waitForURL(new RegExp(`/${slug}/menu/table-1$`));
  });

  test('an unknown store slug renders the graceful unavailable page (force-static, no 404)', async ({ page }) => {
    const res = await page.goto(`${E2E_BASE_URL}/no-such-store-zzz9`);
    expect(res?.status(), 'force-static cannot answer a per-path 404 — see the note in this file').toBe(200);
    await expect(page.getByText(UNAVAILABLE_COPY)).toBeVisible();
    // And it must not pretend to be a working store.
    await expect(page.getByRole('link', { name: 'تصفّح القائمة' })).toHaveCount(0);
  });

  test('a deleted store (dar-salam) is not orderable either', async ({ page }) => {
    const res = await page.goto(`${E2E_BASE_URL}/dar-salam`);
    expect(res?.status()).toBe(200);
    await expect(page.getByText(UNAVAILABLE_COPY)).toBeVisible();
    await expect(page.getByRole('link', { name: 'تصفّح القائمة' })).toHaveCount(0);
  });

  test('www subdomain redirects to apex canonical', async ({ request }) => {
    const res = await request.get('https://www.dokanstore.xyz/', { maxRedirects: 0 });
    expect([301, 308]).toContain(res.status());
  });
});
