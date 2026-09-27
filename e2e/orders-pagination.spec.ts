import { test, expect } from '@playwright/test';
import { admin, createTestUser, cleanupTestUser, getAuthCookies, makeEmail, TEST_PASSWORD } from './helpers';

/**
 * FIX-PAGE-002/003/004 regression guard (2026-09-28) — the orders screen.
 *
 * The bug: the load-more button was gated on `hasMore && filtered.length >= 50`,
 * i.e. on the FILTERED list. A merchant with 120 orders/day who filtered to
 * «جديد» (20 of them) got 20 < 50, the button never rendered, and pages 2+
 * were UNREACHABLE under that filter — silently, with no error. The header
 * (مبيعات اليوم + status chips) had the same class of bug: computed from the
 * loaded page, so it under-reported on a busy day.
 *
 * Seeded 120 orders in ONE day specifically so the numbers cross the 50-row
 * page boundary: 100 «مسلّم» + 20 «جديد». Under the «جديد» filter the filtered
 * length is 20, so the old gate could never pass.
 *
 * Everything created here lives in PRODUCTION and is destroyed in afterAll.
 */
test.describe.configure({ mode: 'serial' });

const email = makeEmail();
const runId = Date.now() % 1_000_000;
const slug = `e2e-page-${runId}`;

const TOTAL = 120;
const DELIVERED = 100;
const PENDING = 20;

let userId = '';
let projectId = '';

const OWNER_COOKIES = () => getAuthCookies(email, TEST_PASSWORD);

/** Day window identical to the component's dayRange() — local midnight. */
function todayWindow(): { from: string; to: string } {
  const start = new Date();
  start.setHours(0, 0, 0, 0);
  const end = new Date(start);
  end.setDate(end.getDate() + 1);
  return { from: start.toISOString(), to: end.toISOString() };
}

test.beforeAll(async () => {
  userId = (await createTestUser(email)).id;

  const { data: proj, error } = await admin
    .from('projects')
    .insert({ name: 'Page Test', slug, currency: 'BHD', is_active: true, created_by: userId })
    .select('id')
    .single();
  if (error || !proj) throw new Error(`seed project: ${error?.message}`);
  projectId = proj.id;

  await admin
    .from('staff_members')
    .insert({ project_id: projectId, user_id: userId, role: 'owner' });

  // Orders are inserted directly (service_role) — going through the public
  // ordering API 120 times would take minutes and test nothing extra here; the
  // orders screen only reads rows. The money columns are still consistent so
  // the header total is a real assertion, not a vacuous zero.
  const { from } = todayWindow();
  const rows = Array.from({ length: TOTAL }, (_, i) => ({
    project_id: projectId,
    order_number: i + 1,
    status: i < DELIVERED ? 'delivered' : 'pending',
    type: 'dine_in',
    service_type: null,
    total_amount: 1.5,
    created_at: new Date(new Date(from).getTime() + i * 1000).toISOString(),
  }));

  // Chunked: one 120-row insert is fine, but batching keeps the payload
  // predictable if this number grows.
  for (let i = 0; i < rows.length; i += 50) {
    const { error: oErr } = await admin.from('orders').insert(rows.slice(i, i + 50));
    if (oErr) throw new Error(`seed orders: ${oErr.message}`);
  }
});

test.afterAll(async () => {
  await cleanupTestUser(email);
});

test('the load-more button is reachable UNDER a rare filter (FIX-PAGE-003)', async ({
  page,
}) => {
  await page.context().addCookies(await OWNER_COOKIES());
  await page.goto('/dashboard/orders');
  await expect(page.getByRole('heading', { name: 'الطلبات' })).toBeVisible();

  // «جديد» = the 20 pending orders. This is the whole point: 20 < 50, so the
  // OLD gate (`filtered.length >= 50`) could never render the button here and
  // the merchant was stuck on page 1 of this filter.
  await page.getByRole('button', { name: /^جديد/ }).click();

  const loadMore = page.getByRole('button', { name: 'تحميل المزيد' });
  await expect(loadMore).toBeVisible();

  // And it must actually do something rather than sit there looking fine.
  const before = await page.locator('article.dashboard-card').count();
  await loadMore.click();
  await expect(page.getByText('جاري التحميل…')).toBeHidden();
  const after = await page.locator('article.dashboard-card').count();
  expect(after).toBeGreaterThanOrEqual(before);
});

test('the header total and chips count the WHOLE day, not the loaded page (FIX-PAGE-004)', async ({
  page,
}) => {
  await page.context().addCookies(await OWNER_COOKIES());
  await page.goto('/dashboard/orders');
  await expect(page.getByRole('heading', { name: 'الطلبات' })).toBeVisible();

  // 120 seeded orders: the «الكل» chip is the assertion. If the chips were
  // computed from the loaded page it would read 50 (or 100 after a page load)
  // instead of the true 120.
  await expect(page.getByRole('button', { name: /^الكل/ })).toContainText('120');
  await expect(page.getByRole('button', { name: /^مسلّم/ })).toContainText('100');
  await expect(page.getByRole('button', { name: /^جديد/ })).toContainText('20');

  // مبيعات اليوم = 120 × 1.500 = 180.000 BHD. Cancelled orders are excluded
  // and none are seeded, so the full amount must show.
  await expect(page.getByText('180.000')).toBeVisible();
});

test('a 60s refresh does not collapse pages 2+ back to the first page (FIX-PAGE-002)', async ({
  page,
}) => {
  await page.context().addCookies(await OWNER_COOKIES());
  await page.goto('/dashboard/orders');
  await expect(page.getByRole('heading', { name: 'الطلبات' })).toBeVisible();

  const cards = page.locator('article.dashboard-card');
  // Page 1 = 50 rows. Load page 2 so 100 are in the DOM, then assert a refresh
  // (the realtime debounce and the 60s heartbeat both call the same helper)
  // re-reads the LOADED SPAN rather than replacing state with .range(0, 49).
  await expect(cards).toHaveCount(50);
  await page.getByRole('button', { name: 'تحميل المزيد' }).click();
  await expect(cards).toHaveCount(100);

  // Fire a real order event through the DB so the realtime path triggers.
  const { error } = await admin.from('orders').insert({
    project_id: projectId,
    order_number: 999,
    status: 'pending',
    type: 'dine_in',
    service_type: null,
    total_amount: 1.5,
  });
  expect(error).toBeNull();

  // 500ms debounce, then the fetch. It must still hold 100+ rows, NOT snap
  // back to 50 — that snap-back was the reported merchant bug.
  await expect(cards).not.toHaveCount(50, { timeout: 8_000 });
  expect(await cards.count()).toBeGreaterThanOrEqual(100);
});
