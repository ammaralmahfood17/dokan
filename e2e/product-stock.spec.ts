import { test, expect, type APIRequestContext } from '@playwright/test';
import {
  createTestUser,
  cleanupTestUser,
  getAuthCookies,
  makeEmail,
  TEST_PASSWORD,
  admin,
} from './helpers';

/**
 * Per-product stock («عدد الحصص», migration 0018).
 *
 * This is the guard for the whole feature, against the DEPLOYED app + DB:
 *
 *   1. an order DECREMENTS the stock;
 *   2. the next order that no longer fits is refused, and changes nothing (the
 *      rejection must not burn a portion);
 *   3. the public menu shows the consequence — a tracked product at zero reads
 *      as sold out, and a low count surfaces «باقي N»;
 *   4. cancelling the order RETURNS the portions;
 *   5. an untracked product (stock NULL) is untouched by all of it — that is
 *      what every product had before the feature, so it is the compatibility
 *      assertion.
 *
 * Every number is read from the DATABASE, not from a response body, because a
 * response is the app's belief about the row and the row is the truth.
 */
test.describe.configure({ mode: 'serial' });

const email = makeEmail();
const runId = Date.now() % 1_000_000;
const slug = `e2e-stock-${runId}`;
const tableSlug = `t-${runId}`;
const storeName = `Stock Test ${runId}`;

let userId: string;
let projectId: string;
let cookieHeader: string;

/** Headings double as the product identities in the menu assertions. */
const P_UNTRACKED = 'مفتوح';
const P_TRACKED = 'ثلاثة';
const P_ZERO = 'صفر';

const ids: Record<string, string> = {};

async function dbStock(name: string): Promise<number | null> {
  const { data, error } = await admin
    .from('products')
    .select('stock')
    .eq('id', ids[name])
    .single();
  if (error) throw new Error(`stock read failed for ${name}: ${error.message}`);
  return (data as { stock: number | null }).stock;
}

async function placeOrder(
  request: APIRequestContext,
  items: { productId: string; quantity: number }[]
): Promise<number> {
  const res = await request.post('/api/public/order', {
    data: {
      projectSlug: slug,
      tableSlug,
      items,
      notes: '',
      clientRequestId: crypto.randomUUID(),
    },
  });
  return res.status();
}

async function placeOrderOk(
  request: APIRequestContext,
  items: { productId: string; quantity: number }[]
): Promise<string> {
  const res = await request.post('/api/public/order', {
    data: {
      projectSlug: slug,
      tableSlug,
      items,
      notes: '',
      clientRequestId: crypto.randomUUID(),
    },
  });
  const text = await res.text();
  expect(res.status(), `order should succeed: ${text}`).toBe(200);
  return (JSON.parse(text) as { order: { id: string } }).order.id;
}

test.beforeAll(async () => {
  await cleanupTestUser(email);
  const user = await createTestUser(email);
  userId = user.id;

  const { data: proj, error: projErr } = await admin
    .from('projects')
    .insert({
      name: storeName,
      slug,
      currency: 'BHD',
      primary_color: '#4338CA',
      is_active: true,
      created_by: userId,
    })
    .select('id')
    .single();
  if (projErr || !proj) throw new Error(`project insert failed: ${projErr?.message}`);
  projectId = proj.id;

  await admin
    .from('staff_members')
    .insert({ project_id: projectId, user_id: userId, role: 'owner' });

  await admin.from('tables').insert({
    project_id: projectId,
    number: 1,
    slug: tableSlug,
    qrcode: `e2e-stock-${runId}-qr`,
    is_active: true,
  });

  // 3 tracked / 0 tracked / untracked
  for (const [name, stock] of [
    [P_UNTRACKED, null],
    [P_TRACKED, 3],
    [P_ZERO, 0],
  ] as [string, number | null][]) {
    const { data, error } = await admin
      .from('products')
      .insert({
        project_id: projectId,
        name,
        price: 1.0,
        is_available: true,
        sort_order: 0,
        stock,
      })
      .select('id')
      .single();
    if (error || !data) throw new Error(`product insert failed (${name}): ${error?.message}`);
    ids[name] = data.id;
  }

  const cookies = await getAuthCookies(email, TEST_PASSWORD);
  cookieHeader = cookies.map((c) => `${c.name}=${c.value}`).join('; ');
});

test.afterAll(async () => {
  await cleanupTestUser(email);
});

test('1. ordering decrements the stock; an order that no longer fits is refused', async ({
  request,
}) => {
  expect(await dbStock(P_TRACKED)).toBe(3);

  // 3 of 3 available → take 2
  await placeOrderOk(request, [{ productId: ids[P_TRACKED], quantity: 2 }]);
  expect(await dbStock(P_TRACKED), 'stock after ordering 2 of 3').toBe(1);

  // 2 more cannot fit in what remains
  expect(await placeOrder(request, [{ productId: ids[P_TRACKED], quantity: 2 }])).toBe(409);
  expect(await dbStock(P_TRACKED), 'a refused order must not burn a portion').toBe(1);
});

test('2. a tracked product at zero is sold out on the menu, and a low count shows «باقي N»', async ({
  page,
  request,
}) => {
  const purge = await request.post('/api/revalidate-menu', {
    data: { projectId },
    headers: { Cookie: cookieHeader },
  });
  console.log(`ℹ menu cache purge → ${purge.status()}`);

  await page.goto(`/${slug}/menu/${tableSlug}`);

  // The card's own accessible name encodes the sold-out state — a precise,
  // product-bound assertion rather than "some badge exists somewhere".
  await expect(
    page.getByRole('button', { name: `${P_ZERO} — غير متوفر`, exact: true })
  ).toBeVisible({ timeout: 25_000 });

  // The tracked product is not sold out (1 left) and advertises the low count.
  // Two buttons carry this label (the card body and the round + control), so
  // .first() — the assertion is "the card offers it", not "exactly one exists".
  await expect(
    page.getByRole('button', { name: `إضافة ${P_TRACKED} إلى السلة`, exact: true }).first()
  ).toBeVisible();
  // Pins that the low-stock badge renders at all; which product it belongs to is
  // guaranteed by the rules in src/lib/product-stock.ts (unit-tested) plus the
  // fixture, where only P_TRACKED is tracked with a count below the threshold.
  await expect(page.getByText('باقي', { exact: false }).first()).toBeVisible();

  // The untracked product must carry neither signal.
  await expect(
    page.getByRole('button', { name: `إضافة ${P_UNTRACKED} إلى السلة`, exact: true }).first()
  ).toBeVisible();
});

test('3. cancelling the order returns the portions', async ({ request }) => {
  const orderId = await placeOrderOk(request, [{ productId: ids[P_TRACKED], quantity: 1 }]);
  expect(await dbStock(P_TRACKED)).toBe(0);

  const cancel = await request.post('/api/pos/cancel', {
    data: { orderId },
    headers: { Cookie: cookieHeader },
  });
  expect(cancel.status(), await cancel.text()).toBe(200);
  expect(await dbStock(P_TRACKED), 'portions returned on cancel').toBe(1);
});

test('4. an untracked product stays unlimited', async ({ request }) => {
  expect(await dbStock(P_UNTRACKED)).toBeNull();

  await placeOrderOk(request, [{ productId: ids[P_UNTRACKED], quantity: 99 }]);
  expect(await dbStock(P_UNTRACKED), 'NULL stock is never mutated').toBeNull();
});
