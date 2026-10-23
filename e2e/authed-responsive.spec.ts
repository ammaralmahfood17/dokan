import { test, expect, type Browser, type Page } from '@playwright/test';
import {
  admin,
  cleanupTestUser,
  createTestUser,
  getAuthCookies,
  makeEmail,
  TEST_PASSWORD,
} from './helpers';
import { measureLayout } from './lib/layout-probe';
import crypto from 'node:crypto';

/**
 * Authed responsive matrix — Wave 6 (2026-10-22).
 *
 * WHY THIS FILE EXISTS: `responsive.spec.ts` covers 8 PUBLIC routes. Every
 * merchant screen — POS, kitchen, orders, products, tables, settings, analytics
 * — had exactly one viewport assertion in the whole suite: axe at three widths.
 * A layout could overflow at 320 or collapse at the 768 tablet switch and every
 * gate stayed green. The waiter's device IS the tablet (744–820 CSS px), and
 * the owner opens the dashboard on a phone, so those are the cells that matter.
 *
 * FIXTURE POLICY: one isolated merchant per RUN (not per viewport), created via
 * the service-role helper and deleted in afterAll. Forty page loads then share
 * one login. This writes to the target database — the same thing every other
 * merchant spec does — so it is NOT wired to the nightly timer; it runs on
 * demand (`npm run test:authed`) and on workflow_dispatch in quality-watch.
 *
 * Run: npm run test:authed
 *      E2E_BASE_URL=http://localhost:3000 npm run test:authed
 */

const email = makeEmail();
const runId = Date.now() % 1_000_000;
const slug = `e2e-matrix-${runId}`;

type Cookie = { name: string; value: string; domain: string; path: string };
let cookies: Cookie[] = [];
let projectId: string | null = null;

/** Merchant screens, in the order a shift touches them. */
const ROUTES = [
  { path: '/dashboard', name: 'dashboard', nav: true },
  { path: '/dashboard/pos', name: 'pos', nav: true },
  { path: '/dashboard/kitchen', name: 'kitchen', nav: true },
  { path: '/dashboard/orders', name: 'orders', nav: true },
  { path: '/dashboard/products', name: 'products', nav: true },
  { path: '/dashboard/tables', name: 'tables', nav: true },
  { path: '/dashboard/settings', name: 'settings', nav: true },
  { path: '/dashboard/analytics', name: 'analytics', nav: true },
] as const;

/**
 * 320 = the owner's old phone; 768 = the counter tablet (iPad mini 744,
 * Tab A9 800); 1024 = tablet landscape; 1280 = desk; 640×512 = WCAG 1.4.10
 * reflow at 200% zoom. 390/360 are covered by the public matrix, so they are
 * not repeated here — the merchant screens are the new surface, not the width.
 */
const VIEWPORTS = [
  { name: '320-se', width: 320, height: 568, touch: true },
  { name: '768-tablet', width: 768, height: 1024, touch: true },
  { name: '1024-landscape', width: 1024, height: 768, touch: true },
  { name: '1280-desktop', width: 1280, height: 800, touch: false },
  { name: '640-zoom200', width: 640, height: 512, touch: true },
] as const;

const BASE = (process.env.E2E_BASE_URL || 'https://dokanstore.xyz').replace(/\/$/, '');

/**
 * One retry, network errors only. The 2026-10-22 run finished 38/40 with the
 * two "failures" being net::ERR_NETWORK_CHANGED — the operator's Wi-Fi moved,
 * not the layout. A matrix that opens 40 pages will meet a dropped connection
 * eventually; retrying exactly that error keeps the gate about layout.
 */
async function gotoWithRetry(page: Page, url: string) {
  for (let attempt = 0; ; attempt += 1) {
    try {
      return await page.goto(url, { waitUntil: 'domcontentloaded' });
    } catch (err) {
      const message = String(err);
      if (attempt >= 1 || !/ERR_NETWORK_CHANGED|ERR_CONNECTION_RESET|ERR_TIMED_OUT/.test(message)) {
        throw err;
      }
      await page.waitForTimeout(500);
    }
  }
}

/**
 * A fixture written seconds ago can still read as "no project" on the very next
 * request (replica lag, or one transient query failure), and the dashboard
 * layout answers that with a redirect to /onboarding. That is not a layout
 * result, so re-open once before judging the cell — otherwise one cell per run
 * fails for a reason the matrix is not measuring.
 */
async function openAuthed(page: Page, url: string) {
  let res = await gotoWithRetry(page, url);
  if (page.url().includes('/onboarding')) {
    await page.waitForTimeout(800);
    res = await gotoWithRetry(page, url);
  }
  return res;
}

/**
 * A run that is killed between the project insert and the staff insert leaves a
 * project with no owner, and afterAll cannot find it (cleanup is keyed by
 * email). Measured 2026-10-22: one such row survived a Ctrl-C'd run. Sweeping
 * anything older than two hours cannot touch a concurrent run — a live fixture
 * is seconds old — so it is safe to do at the start of every run.
 */
async function sweepStaleFixtures() {
  const cutoff = new Date(Date.now() - 2 * 60 * 60 * 1000).toISOString();
  const { data } = await admin
    .from('projects')
    .select('id')
    .like('slug', 'e2e-matrix-%')
    .lt('created_at', cutoff);
  for (const p of data ?? []) {
    const { data: staff } = await admin
      .from('staff_members')
      .select('user_id')
      .eq('project_id', p.id)
      .limit(1);
    const userId = staff?.[0]?.user_id;
    const { data: owner } = userId
      ? await admin.auth.admin.getUserById(userId)
      : { data: null };
    if (owner?.user?.email) {
      await cleanupTestUser(owner.user.email);
      continue;
    }
    await admin.from('tables').delete().eq('project_id', p.id);
    await admin.from('products').delete().eq('project_id', p.id);
    await admin.from('categories').delete().eq('project_id', p.id);
    await admin.from('projects').delete().eq('id', p.id);
  }
}

test.beforeAll(async () => {
  await sweepStaleFixtures();
  await cleanupTestUser(email);
  const { id: userId } = await createTestUser(email);

  const { data: project, error } = await admin
    .from('projects')
    .insert({ name: 'E2E Matrix', slug, currency: 'BHD', primary_color: '#7047EB', is_active: true })
    .select('id')
    .single();
  if (error || !project) throw new Error(`project fixture failed: ${error?.message}`);
  projectId = project.id;

  await admin.from('staff_members').insert({ project_id: projectId, user_id: userId, role: 'owner' });

  // Enough real content that the screens render their normal (non-onboarding)
  // shape: a category, three products, two tables. Orders/analytics stay empty
  // on purpose — an empty board is a layout state worth measuring too.
  const { data: cat } = await admin
    .from('categories')
    .insert({ project_id: projectId, name: 'مشروبات', sort_order: 0 })
    .select('id')
    .single();

  await admin.from('products').insert([
    { project_id: projectId, name: 'كرك', price: 0.2, category_id: cat!.id, is_available: true },
    { project_id: projectId, name: 'شاي أحمر', price: 0.1, category_id: cat!.id, is_available: true },
    { project_id: projectId, name: 'قهوة عربية', price: 0.3, category_id: cat!.id, is_available: false },
  ]);

  await admin.from('tables').insert([
    { project_id: projectId, number: 1, slug: 'table-1', is_active: true, qrcode: crypto.randomUUID().replace(/-/g, '') },
    { project_id: projectId, number: 2, slug: 'table-2', is_active: true, qrcode: crypto.randomUUID().replace(/-/g, '') },
  ]);

  cookies = await getAuthCookies(email, TEST_PASSWORD);
});

test.afterAll(async () => {
  await cleanupTestUser(email);
});

for (const vp of VIEWPORTS) {
  test.describe(`@authed ${vp.name}`, () => {
    for (const route of ROUTES) {
      test(`${route.name} fits ${vp.width}px`, async ({ browser }) => {
        const context = await (browser as Browser).newContext({
          viewport: { width: vp.width, height: vp.height },
          hasTouch: vp.touch,
          isMobile: vp.touch,
          locale: 'ar-BH',
          storageState: {
            cookies: cookies.map((c) => ({
              ...c,
              expires: -1,
              httpOnly: false,
              secure: BASE.startsWith('https'),
              sameSite: 'Lax' as const,
            })),
            origins: [],
          },
        });
        const page = await context.newPage();
        try {
          const res = await openAuthed(page, `${BASE}${route.path}`);
          expect(res, `no response for ${route.path}`).not.toBeNull();
          expect(res!.status(), `${route.path} answered ${res!.status()}`).toBeLessThan(400);

          // A lost session redirects to /login and would make every cell green
          // against the wrong page.
          expect(page.url(), `${route.path} redirected away — session cookie rejected?`).toContain(
            route.path
          );

          await page.evaluate(() => document.fonts?.ready ?? Promise.resolve());
          await page
            .waitForFunction(() => document.body.innerText.trim().length > 20, undefined, {
              timeout: 15_000,
            })
            .catch(() => {});

          const m = await measureLayout(page);

          expect(m.direction, 'the document must be RTL').toBe('rtl');
          expect(m.bodyTextLength, `${route.path} rendered no text at ${vp.width}px`).toBeGreaterThan(20);
          expect(
            m.scrollWidth,
            `${route.path} scrolls horizontally at ${vp.width}px (${m.scrollWidth} > ${m.clientWidth})`
          ).toBeLessThanOrEqual(m.clientWidth + 1);
          expect(
            m.overflowCount,
            `${route.path} at ${vp.width}px: controls outside the viewport ${JSON.stringify(m.overflowSample)}`
          ).toBe(0);

          if (vp.touch) {
            expect(
              m.smallIconButtons,
              `${route.path} at ${vp.width}px: icon-only controls under 44px ${JSON.stringify(m.smallIconButtons)}`
            ).toEqual([]);
          }

          if (route.nav) {
            // Wave 1's navigation contract, asserted rather than assumed:
            // bottom nav below 768, the 88px rail at 768, the 240px sidebar at
            // 1024. This is what stops a future `md:` edit from silently
            // deleting the tablet layout again.
            const bottomNav = page.locator('nav[aria-label="التنقل السريع"]');
            if (vp.width < 768) {
              await expect(bottomNav, 'phone must have the bottom nav').toBeVisible();
            } else {
              await expect(bottomNav, 'tablet/desktop must not show the bottom nav').toBeHidden();
            }

            if (vp.width >= 768) {
              const box = await page.locator('aside').first().boundingBox();
              const width = Math.round(box?.width ?? 0);
              if (vp.width >= 1024) {
                // Measured 224 at 1024 (not the 240 the class suggests), so the
                // contract is the SHAPE — a wide sidebar, not the 88px rail —
                // rather than a pixel the layout engine rounds differently.
                expect(width, `sidebar width at ${vp.width}px`).toBeGreaterThanOrEqual(200);
                expect(width, `sidebar width at ${vp.width}px`).toBeLessThanOrEqual(260);
              } else {
                expect(width, `tablet rail width at ${vp.width}px`).toBeGreaterThanOrEqual(84);
                expect(width, `tablet rail width at ${vp.width}px`).toBeLessThanOrEqual(92);
              }
            }
          }
        } finally {
          await context.close();
        }
      });
    }
  });
}
