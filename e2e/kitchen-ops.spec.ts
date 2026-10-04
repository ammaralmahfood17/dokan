import { test, expect, type Page, type APIRequestContext } from '@playwright/test';
import { createClient, type SupabaseClient } from '@supabase/supabase-js';
import {
  admin,
  createTestUser,
  cleanupTestUser,
  getAuthCookies,
  makeEmail,
  TEST_PASSWORD,
  url,
  anonKey,
} from './helpers';

/**
 * KITCHEN OPS — the fulfilment lifecycle (KDS) + the service-request side of
 * an order, driven through the REAL UI and asserted against the REAL DB after
 * every transition. One serial chain a reader can follow end to end:
 *
 *   place (public API) → listed on the KDS board → بدء التحضير → جاهز للتسليم
 *   → تم التسليم ✓ → cancelled order can never be revived → waiter + bill
 *   service requests are typed rows, NOT real orders.
 *
 * The difference vs money-path.spec.ts: that one walks the happy path and
 * stops at "ready". This one watches the ITEM-level state machine
 * (order_items.status moving in lock-step with orders.status) and proves the DB
 * really changed after every click — a green kitchen board with a stale DB is
 * the failure this spec exists to catch.
 *
 * Verified UI strings (grepped, never invented):
 *   src/components/dashboard/kitchen/kitchen-ticket.tsx
 *     status==='pending'   → button "بدء التحضير"
 *     status==='preparing' → button "جاهز للتسليم"
 *     status==='ready'     → button "تم التسليم ✓"
 *     <article aria-label={`طلب رقم ${order.order_number}…`}>
 *     table label → `طاولة NN` (Arabic word + `dir="ltr"` numerals, 2026-10-02);  qty box → `{quantity}×`
 *   src/lib/kitchen-tickets.ts  (STAGE_COLUMNS → <section aria-label>)
 *     'جديد' | 'قيد التحضير' | 'جاهز للتسليم'
 *   src/app/dashboard/kitchen/kitchen-client.tsx
 *     heading `{projectName} — شاشة المطبخ`, board region "تذاكر المطبخ"
 *
 * Verified API contracts:
 *   POST /api/public/order  { projectSlug, tableSlug, items:[{ productId,
 *     quantity, addonIds?, notes? }], notes?, clientRequestId? }
 *     → 200 { order: { id, status, totalAmount, orderNumber } }
 *   POST /api/pos/cancel    { orderId }   (staff session)  → 200 { ok: true }
 *   POST /api/public/waiter { projectSlug, tableSlug } → 200 { ok, id } /
 *     400 'بيانات ناقصة' / 400 'معرّف المتجر غير صالح'
 *   POST /api/public/bill   same contract as waiter
 *
 * Everything it creates lives in an isolated store (unique slug) and is
 * removed in afterAll.
 */
test.describe.configure({ mode: 'serial' });

/* ------------------------------------------------------------------ *
 * UI strings — each one grepped in the source file named above.
 * ------------------------------------------------------------------ */
const BTN_START = 'بدء التحضير'; // kitchen-ticket.tsx — pending stage
const BTN_READY = 'جاهز للتسليم'; // kitchen-ticket.tsx — preparing stage
const BTN_DELIVER = 'تم التسليم ✓'; // kitchen-ticket.tsx — ready stage
const COL_NEW = 'جديد'; // kitchen-tickets.ts STAGE_COLUMNS[pending]
const COL_PREPARING = 'قيد التحضير'; // kitchen-tickets.ts STAGE_COLUMNS[preparing]
const COL_READY = 'جاهز للتسليم'; // kitchen-tickets.ts STAGE_COLUMNS[ready]
const NOTES_WAITER = 'طلب موظف'; // api/public/waiter/route.ts insert.notes
const NOTES_BILL = 'طلب فاتورة'; // api/public/bill/route.ts insert.notes

const email = makeEmail();
const runId = Date.now() % 1_000_000;
const slug = `e2e-kit-${runId}`;
const storeName = `مطبخ الفحص ${runId}`;
const tableSlug = 'table-1';
const productAName = `شاي أول ${runId}`;
const productBName = `شاي ثانٍ ${runId}`;
// Prices chosen so the server-side total is unambiguous: 1.5×2 + 2.25×1 = 5.250
const PRICE_A = 1.5;
const PRICE_B = 2.25;
const EXPECTED_TOTAL = 5.25;

type AuthCookie = { name: string; value: string; domain: string; path: string };

let authCookies: AuthCookie[] = [];
let cookieHeader = '';
let userId = '';
let projectId = '';
let tableId = '';
let productAId = '';
let productBId = '';
let authed: SupabaseClient;

let orderANotes = '';
let orderAId = '';
let orderANumber = 0;
let orderBId = '';
let orderBNumber = 0;
let waiterRowId = '';
let billRowId = '';

/* ------------------------------------------------------------------ *
 * DB helpers — every assertion below reads the DB, never the DOM.
 * ------------------------------------------------------------------ */
type OrderSnapshot = {
  id: string;
  status: string;
  total_amount: number;
  service_type: string | null;
  order_number: number;
  table_id: string | null;
  notes: string | null;
  order_items: { id: string; status: string; product_name: string; quantity: number }[] | null;
};

async function dbOrder(id: string): Promise<OrderSnapshot> {
  const { data, error } = await admin
    .from('orders')
    .select(
      'id, status, total_amount, service_type, order_number, table_id, notes, order_items(id, status, product_name, quantity)'
    )
    .eq('id', id)
    .single();
  if (error) throw new Error(`order read failed for ${id}: ${error.message}`);
  return data as unknown as OrderSnapshot;
}

/** Compact, deterministic view used by expect.poll (order + every item). */
async function dbState(id: string): Promise<{ status: string; items: string[] }> {
  const row = await dbOrder(id);
  const items = (row.order_items ?? []).map((i) => i.status).sort();
  return { status: row.status, items };
}

async function itemCount(id: string): Promise<number> {
  const { count, error } = await admin
    .from('order_items')
    .select('id', { count: 'exact', head: true })
    .eq('order_id', id);
  if (error) throw new Error(`item count failed for ${id}: ${error.message}`);
  return count ?? 0;
}

/* ------------------------------------------------------------------ *
 * Public API helper — the exact body shape /api/public/order expects.
 * ------------------------------------------------------------------ */
async function placeOrder(
  request: APIRequestContext,
  items: { productId: string; quantity: number; notes?: string }[],
  notes: string
): Promise<{ id: string; orderNumber: number }> {
  const res = await request.post('/api/public/order', {
    data: {
      projectSlug: slug,
      tableSlug,
      items,
      notes,
      // Optional idempotency key (migration 0014) — must be a real uuid or the
      // route answers 400 instead of ignoring it.
      clientRequestId: crypto.randomUUID(),
    },
  });
  const text = await res.text();
  expect(res.status(), `public order failed: ${text}`).toBe(200);
  const body = JSON.parse(text) as {
    order: { id: string; status: string; totalAmount: number; orderNumber: number };
  };
  return { id: body.order.id, orderNumber: body.order.orderNumber };
}

async function cancelViaApi(request: APIRequestContext, orderId: string) {
  return request.post('/api/pos/cancel', {
    data: { orderId },
    headers: { Cookie: cookieHeader },
  });
}

/* ------------------------------------------------------------------ *
 * UI helpers
 * ------------------------------------------------------------------ */
async function openKitchen(page: Page) {
  await page.context().addCookies(authCookies);
  const res = await page.goto('/dashboard/kitchen');
  expect(res?.status(), 'kitchen board should render for the owner').toBe(200);
  await expect(
    page.getByRole('heading', { name: `${storeName} — شاشة المطبخ` })
  ).toBeVisible({ timeout: 25_000 });
}

/**
 * The ticket <article aria-label="طلب رقم N"> for one order. The label grows
 * " - متأخر" once a ticket is overdue (kitchen-ticket.tsx), so match by prefix
 * + word boundary instead of an exact name.
 */
function ticket(page: Page, orderNumber: number) {
  return page.getByRole('article', { name: new RegExp(`^طلب رقم ${orderNumber}\\b`) });
}

/** The stage column <section aria-label="جديد | قيد التحضير | جاهز للتسليم">. */
function column(page: Page, label: string) {
  return page.getByRole('region', { name: label });
}

/**
 * Assert a KDS column does not hold `text`.
 *
 * The board renders a column only while it has tickets, so as a table empties
 * out the region disappears entirely — and `expect(locator).not.toContainText()`
 * on a locator that matches NOTHING fails with "element(s) not found" instead of
 * passing. A plain negative assertion is therefore unsatisfiable on a nearly
 * empty board: it either passes for the wrong reason while the column is full,
 * or fails for the wrong reason once the column is gone.
 *
 * The honest form is "absent, or present without our text" — which is what
 * this asserts. Pair it with a positive locator assertion (`toHaveCount(0)` on
 * the ticket itself, or a DB poll) so the step is still proving something.
 */
async function columnLacks(page: Page, label: string, text: string): Promise<void> {
  const region = column(page, label);
  if ((await region.count()) === 0) return; // column not rendered: it holds nothing
  await expect(region).not.toContainText(text);
}

/* ------------------------------------------------------------------ *
 * SETUP
 * ------------------------------------------------------------------ */
test.beforeAll(async () => {
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
  if (projErr || !proj) throw new Error(`seed project: ${projErr?.message}`);
  projectId = proj.id;

  const { error: staffErr } = await admin
    .from('staff_members')
    .insert({ project_id: projectId, user_id: userId, role: 'owner' });
  if (staffErr) throw new Error(`seed staff: ${staffErr.message}`);

  const { data: cat, error: catErr } = await admin
    .from('categories')
    .insert({ project_id: projectId, name: `قائمة ${runId}`, sort_order: 1, is_active: true })
    .select('id')
    .single();
  if (catErr || !cat) throw new Error(`seed category: ${catErr?.message}`);

  const { data: prods, error: prodErr } = await admin
    .from('products')
    .insert([
      {
        project_id: projectId,
        category_id: cat.id,
        name: productAName,
        price: PRICE_A,
        is_available: true,
        sort_order: 1,
      },
      {
        project_id: projectId,
        category_id: cat.id,
        name: productBName,
        price: PRICE_B,
        is_available: true,
        sort_order: 2,
      },
    ])
    .select('id, name');
  if (prodErr || !prods) throw new Error(`seed products: ${prodErr?.message}`);
  productAId = prods.find((p: { name: string }) => p.name === productAName)?.id ?? '';
  productBId = prods.find((p: { name: string }) => p.name === productBName)?.id ?? '';
  if (!productAId || !productBId) throw new Error('seed products: missing ids');

  const { data: tbl, error: tblErr } = await admin
    .from('tables')
    .insert({
      project_id: projectId,
      number: 1,
      slug: tableSlug,
      qrcode: `e2e-${runId}-qr`,
      is_active: true,
    })
    .select('id')
    .single();
  if (tblErr || !tbl) throw new Error(`seed table: ${tblErr?.message}`);
  tableId = tbl.id;

  // One session, reused by every test (the browser context and the API
  // request context are both fresh per test, so cookies are re-attached).
  authCookies = await getAuthCookies(email, TEST_PASSWORD);
  cookieHeader = authCookies.map((c) => `${c.name}=${c.value}`).join('; ');

  // Anon client signed in as the owner — the SAME rpc the KDS buttons call
  // from the browser (advance_order_status with a real auth.uid()).
  authed = createClient(url, anonKey(), {
    auth: { persistSession: false, autoRefreshToken: false },
  });
  const { error: signInErr } = await authed.auth.signInWithPassword({
    email,
    password: TEST_PASSWORD,
  });
  if (signInErr) throw new Error(`signIn failed: ${signInErr.message}`);
});

test.afterAll(async () => {
  // orders → order_items → tables → products → categories → staff → project → user
  await cleanupTestUser(email);
});

/* ====================================================================== *
 * 1) PLACE — public API creates a real order with two lines
 * ====================================================================== */
test('place: POST /api/public/order → 2-item order row, priced server-side', async ({
  request,
}) => {
  const notes = `ملاحظة الطلب ${runId}`;
  orderANotes = notes;
  const { id, orderNumber } = await placeOrder(
    request,
    [
      { productId: productAId, quantity: 2, notes: '' },
      { productId: productBId, quantity: 1, notes: '' },
    ],
    notes
  );
  orderAId = id;
  orderANumber = orderNumber;
  expect(orderAId, 'order id must be a uuid').toMatch(
    /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i
  );
  expect(orderANumber).toBeGreaterThan(0);

  // DB truth: one real order (service_type NULL), priced by the SERVER, with
  // exactly the two lines requested and both items still 'pending'.
  const row = await dbOrder(orderAId);
  expect(row.status).toBe('pending');
  expect(row.service_type, 'a real order has service_type NULL').toBeNull();
  expect(row.table_id).toBe(tableId);
  expect(row.order_number).toBe(orderANumber);
  expect(row.notes).toBe(notes);
  expect(Number(row.total_amount)).toBeCloseTo(EXPECTED_TOTAL, 3);
  expect(await itemCount(orderAId)).toBe(2);
  expect(row.order_items?.map((i) => i.product_name).sort()).toEqual(
    [productAName, productBName].sort()
  );
  expect(row.order_items?.every((i) => i.status === 'pending')).toBe(true);
});

/* ====================================================================== *
 * 2) KITCHEN BOARD — the ticket is listed, in the 'جديد' column, with its lines
 * ====================================================================== */
test('kitchen board: ticket listed in the جديد column with both product lines', async ({
  page,
}) => {
  await openKitchen(page);

  const card = ticket(page, orderANumber);
  await expect(card, 'the new order must be on the KDS board').toBeVisible({ timeout: 25_000 });

  // Lines: qty box + product name, and the table it belongs to.
  await expect(card.getByText('2×', { exact: true })).toBeVisible();
  await expect(card.getByText(productAName, { exact: true })).toBeVisible();
  await expect(card.getByText('1×', { exact: true })).toBeVisible();
  await expect(card.getByText(productBName, { exact: true })).toBeVisible();
  // 2026-10-02: the KDS label is localized — Arabic word + dir="ltr" numerals.
  await expect(card.getByText('طاولة 01', { exact: true })).toBeVisible();
  await expect(card.getByText(orderANotes, { exact: true })).toBeVisible();

  // Column state: sits in 'جديد' with the start button, nowhere else.
  await expect(column(page, COL_NEW)).toContainText(productAName, { timeout: 20_000 });
  await columnLacks(page, COL_PREPARING, productAName);
  await columnLacks(page, COL_READY, productAName);
  await expect(card.getByRole('button', { name: BTN_START, exact: true })).toBeVisible();
});

/* ====================================================================== *
 * 3) START — "بدء التحضير" moves order AND both items to preparing
 * ====================================================================== */
test('بدء التحضير: click the real button → orders + BOTH order_items are preparing', async ({
  page,
}) => {
  await openKitchen(page);

  const card = ticket(page, orderANumber);
  await expect(card).toBeVisible({ timeout: 25_000 });
  await card.getByRole('button', { name: BTN_START, exact: true }).click();

  // DB truth first: the parent order AND every line moved, atomically.
  await expect
    .poll(() => dbState(orderAId), { timeout: 20_000, message: 'order + items → preparing' })
    .toEqual({ status: 'preparing', items: ['preparing', 'preparing'] });

  // Board followed: the ticket is now in 'قيد التحضير' offering the next action.
  await expect(column(page, COL_PREPARING)).toContainText(productAName, { timeout: 20_000 });
  await columnLacks(page, COL_NEW, productAName);
  await expect(card.getByRole('button', { name: BTN_READY, exact: true })).toBeVisible();
  await expect(card.getByRole('button', { name: BTN_START, exact: true })).toHaveCount(0);
});

/* ====================================================================== *
 * 4) AUTO-ADVANCE — every item ready ⟹ parent order ready (one transaction)
 * ====================================================================== */
test('جاهز للتسليم: every item ready AND the parent order is ready', async ({ page }) => {
  await openKitchen(page);

  const card = ticket(page, orderANumber);
  await expect(card).toBeVisible({ timeout: 25_000 });
  await card.getByRole('button', { name: BTN_READY, exact: true }).click();

  // advance_order_status updates orders + order_items in ONE transaction, so
  // the derived order status can never lag behind its lines: the pair below is
  // asserted as a single polled snapshot rather than two independent waits.
  await expect
    .poll(() => dbState(orderAId), { timeout: 20_000, message: 'order + items → ready' })
    .toEqual({ status: 'ready', items: ['ready', 'ready'] });

  await expect(column(page, COL_READY)).toContainText(productAName, { timeout: 20_000 });
  await columnLacks(page, COL_PREPARING, productAName);
  await expect(card.getByRole('button', { name: BTN_DELIVER, exact: true })).toBeVisible();
});

/* ====================================================================== *
 * 5) DELIVER — "تم التسليم ✓" closes the order out
 * ====================================================================== */
test('تم التسليم ✓: the ticket leaves the board and the DB says delivered', async ({ page }) => {
  await openKitchen(page);

  const card = ticket(page, orderANumber);
  await expect(card).toBeVisible({ timeout: 25_000 });
  await card.getByRole('button', { name: BTN_DELIVER, exact: true }).click();

  // 'delivered' is order-level only: order_items.status CHECK has no such
  // value, so the RPC deliberately leaves the lines at 'ready'.
  await expect
    .poll(() => dbState(orderAId), { timeout: 20_000, message: 'order delivered, lines stay ready' })
    .toEqual({ status: 'delivered', items: ['ready', 'ready'] });

  // The KDS board only renders pending/preparing/ready — a delivered ticket
  // is gone from every column. Line 425 is the real proof (the ticket element
  // itself is gone). The two column assertions below are deliberately
  // "either absent, or present but without our product": once the last ticket
  // leaves, the column is not rendered at all, and `not.toContainText` on a
  // NON-EXISTENT locator fails rather than passes, which is what this spec used
  // to do on an empty board.
  await expect(ticket(page, orderANumber)).toHaveCount(0, { timeout: 20_000 });
  await columnLacks(page, COL_READY, productAName);
  await columnLacks(page, COL_NEW, productAName);
  await expect(page.getByText(BTN_START, { exact: true })).toHaveCount(0);
});

/* ====================================================================== *
 * 6) CANCEL PATH — cancelled is terminal: a stale advance cannot revive it
 * ====================================================================== */
test('cancel: POST /api/pos/cancel → cancelled, and a stale advance is rejected', async ({
  request,
  page,
}) => {
  // Second real order, placed through the same public API.
  const { id, orderNumber } = await placeOrder(
    request,
    [{ productId: productBId, quantity: 1, notes: '' }],
    `طلب قابل للإلغاء ${runId}`
  );
  orderBId = id;
  orderBNumber = orderNumber;
  expect((await dbState(orderBId)).status).toBe('pending');

  // It shows on the board, and the staff cancel API kills it.
  await openKitchen(page);
  const card = ticket(page, orderBNumber);
  await expect(card).toBeVisible({ timeout: 25_000 });
  await expect(card.getByRole('button', { name: BTN_START, exact: true })).toBeVisible();

  const cancelRes = await cancelViaApi(request, orderBId);
  const cancelText = await cancelRes.text();
  expect(cancelRes.status(), `cancel should succeed: ${cancelText}`).toBe(200);
  expect(JSON.parse(cancelText).ok).toBe(true);

  // DB truth: cancelled, and the lines were NOT touched by the cancel route.
  await expect
    .poll(() => dbState(orderBId), { timeout: 20_000, message: 'order cancelled' })
    .toEqual({ status: 'cancelled', items: ['pending'] });

  // A stale kitchen screen (or a replayed click) tries pending → preparing.
  // The RPC is a compare-and-swap on the expected status, so it must reject
  // with STALE_STATUS and the order must stay cancelled.
  const stale = await authed.rpc('advance_order_status', {
    p_order_id: orderBId,
    p_expected_status: 'pending',
    p_new_status: 'preparing',
  });
  expect(stale.error, 'a stale advance of a cancelled order must fail').not.toBeNull();
  expect(String(stale.error?.message)).toContain('STALE_STATUS');
  expect((await dbState(orderBId)).status).toBe('cancelled');

  // And the board drops it: neither pending nor preparing nor ready.
  await openKitchen(page);
  await expect(ticket(page, orderBNumber)).toHaveCount(0, { timeout: 20_000 });
  await columnLacks(page, COL_NEW, productBName);
  await expect(page.getByText(BTN_START, { exact: true })).toHaveCount(0);
});

/* ====================================================================== *
 * 7) SERVICE REQUESTS — waiter + bill are typed rows, never real orders
 * ====================================================================== */
test('waiter + bill: typed service_type rows, no line items, off the KDS board', async ({
  request,
  page,
}) => {
  // 7a) Bad bodies are rejected cleanly (400, not a 500 / silent write).
  const missingTable = await request.post('/api/public/waiter', { data: { projectSlug: slug } });
  expect(missingTable.status()).toBe(400);
  expect((await missingTable.json()).error).toBe('بيانات ناقصة');

  const missingProject = await request.post('/api/public/bill', { data: { tableSlug } });
  expect(missingProject.status()).toBe(400);
  expect((await missingProject.json()).error).toBe('بيانات ناقصة');

  const badSlug = await request.post('/api/public/waiter', {
    data: { projectSlug: 'Not A Slug', tableSlug },
  });
  expect(badSlug.status()).toBe(400);
  expect((await badSlug.json()).error).toBe('معرّف المتجر غير صالح');

  // No row may have been written by any of the rejected calls.
  const { count: beforeRows } = await admin
    .from('orders')
    .select('id', { count: 'exact', head: true })
    .eq('project_id', projectId)
    .in('service_type', ['waiter', 'bill']);
  expect(beforeRows ?? 0).toBe(0);

  // 7b) The two happy paths.
  for (const endpoint of ['waiter', 'bill'] as const) {
    const res = await request.post(`/api/public/${endpoint}`, {
      data: { projectSlug: slug, tableSlug },
    });
    const text = await res.text();
    expect(res.status(), `${endpoint} should succeed: ${text}`).toBe(200);
    const body = JSON.parse(text) as { ok: boolean; id: string };
    expect(body.ok).toBe(true);
    expect(body.id).toMatch(
      /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i
    );
    if (endpoint === 'waiter') waiterRowId = body.id;
    else billRowId = body.id;
  }

  // 7c) DB truth: both rows are typed, zero-amount, and carry NO line items.
  for (const [id, serviceType, noteText] of [
    [waiterRowId, 'waiter', NOTES_WAITER],
    [billRowId, 'bill', NOTES_BILL],
  ] as const) {
    const row = await dbOrder(id);
    expect(row.status).toBe('pending');
    expect(row.service_type, `${serviceType} row must be typed`).toBe(serviceType);
    expect(Number(row.total_amount), `${serviceType} request has no money`).toBe(0);
    expect(row.table_id).toBe(tableId);
    expect(row.notes).toContain(noteText);
    expect(row.order_items ?? [], `${serviceType} must not create line items`).toEqual([]);
    expect(await itemCount(id)).toBe(0);
  }

  // 7d) Not orders: the KDS board and the orders board both filter on
  // service_type IS NULL, so neither service row is ever shown as a ticket.
  await openKitchen(page);
  await expect(page.getByText(NOTES_WAITER)).toHaveCount(0);
  await expect(page.getByText(NOTES_BILL)).toHaveCount(0);
  await expect(page.getByText(BTN_START, { exact: true })).toHaveCount(0);
  await expect(page.getByText('بانتظار الطلبات…')).toBeVisible({ timeout: 20_000 });

  await page.goto('/dashboard/orders');
  // Scope to the delivered order's card (`order-<N>` header, orders-client.tsx
  // line 434) and match the line's product-name text node — the card renders
  // `<strong>2×</strong> شاي أول NNN`, so the name is not the whole line text.
  const cardA = page.locator('article').filter({ hasText: `order-${orderANumber}` });
  await expect(cardA).toBeVisible({ timeout: 25_000 });
  await expect(cardA.getByText(new RegExp(`${productAName}$`))).toBeVisible();
  await expect(cardA.getByText(new RegExp(`${productBName}$`))).toBeVisible();
  // Service requests are not orders: the board filters service_type IS NULL.
  await expect(page.getByText(NOTES_WAITER)).toHaveCount(0);
  await expect(page.getByText(NOTES_BILL)).toHaveCount(0);
});
