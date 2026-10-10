import { test, expect, type Page, type Locator, type BrowserContext, type APIRequestContext } from '@playwright/test';
import { createClient } from '@supabase/supabase-js';
import {
  admin,
  createTestUser,
  cleanupTestUser,
  getAuthCookies,
  makeEmail,
  TEST_PASSWORD,
  url,
  anonKey,
  E2E_BASE_URL,
} from './helpers';

/** Table scan token: public orders are gated on it since REQUIRE_TABLE_TOKEN=true. */
const TABLE_TOKEN = '78787878787878787878787878787878';

/**
 * THE CUSTOMER JOURNEY — the public, UNAUTHENTICATED path a real diner takes:
 *   scan the table QR → browse the menu → add items (+ options) → adjust the
 *   cart → submit → watch the order move through the kitchen → and the two
 *   failure modes that matter (sold-out item, empty cart).
 *
 * Everything happens inside ONE isolated test store seeded via the service
 * role (`admin`), mirroring e2e/pos-path.spec.ts, and it is destroyed in
 * afterAll — the real merchant store (estikana) is never touched.
 *
 * WHY ONE SERIAL DESCRIBE: the state under test is CLIENT state. The order
 * confirmation screen is React state inside a single page; a fresh `page`
 * fixture per test would lose it and there would be nothing to assert in
 * step 7. So the customer context + page are created ONCE in beforeAll
 * (worker-scoped `browser`/`playwright` fixtures) and shared by every step.
 *
 * SELECTORS / STRINGS below were all grepped in src before use:
 *   src/components/menu/cart-sheet.tsx    «سلتك» (Sheet title), «تأكيد الطلب»
 *                                        (Button), «الإجمالي» (total label),
 *                                        aria-label «إنقاص الكمية» / «زيادة الكمية»
 *   src/app/[projectSlug]/menu/[tableSlug]/menu-client.tsx
 *                                        «السلة» + «إتمام الطلب» (cart bar),
 *                                        «طلب المزيد» (success screen),
 *                                        «أضف إلى السلة» (picker confirm),
 *                                        aria-label «إغلاق» (Sheet close),
 *                                        `${lang === 'en' ? 'Table' : 'طاولة'}`
 *                                        + padStart(2,'0') → «طاولة» «01»
 *   src/components/menu/product-card.tsx  «غير متوفر» (sold-out badge),
 *                                        aria-label `إضافة ${name} إلى السلة`,
 *                                        `زيادة كمية ${name}`, `إنقاص كمية ${name}`,
 *                                        `${name} — غير متوفر` (sold-out aria-label)
 *   src/components/menu/order-success-state.tsx
 *                                        «تم استلام طلبك» (h1), «رقم الطلب»
 *                                        + `order-{n}`, «قيد الانتظار» /
 *                                        «قيد التحضير» / «جاهز» (live step strip),
 *                                        «طلبك قيد الانتظار — يتم تحديث الحالة
 *                                        تلقائيًا» / «طلبك قيد التحضير — يتم تحديث
 *                                        الحالة تلقائيًا» (current stage line),
 *                                        «طلبك جاهز 🎉» (terminal status line),
 *                                        «تعذّر تحديث الحالة — سنخبرك عند الجاهزية» (lost)
 *   src/app/api/public/order/route.ts     400 'منتج غير متاح أو لا ينتمي لهذا المتجر'
 *                                        (createSecureOrder, src/lib/order-pricing.ts:156)
 */
test.describe.configure({ mode: 'serial' });

/* Module scope: `beforeAll` runs after the file body, but `afterAll` needs the
 * SAME email, and a per-call makeEmail() would clean up a different (nonexistent)
 * user and leak the whole store into the production DB. */
const email = makeEmail();
const runId = Date.now() % 1_000_000;
const slug = `e2e-cust-${runId}`;
/** Second store, ONLY used to prove the order-status endpoint is tenant-scoped.
 *  Created and destroyed inside this file (it has no owner, so
 *  cleanupTestUser would not find it). */
const otherSlug = `e2e-cust-other-${runId}`;

const storeName = `مقهى تجربة العميل ${runId}`;
const categoryName = `مشروبات ${runId}`;
// Unique per run — a repeat or parallel run must never collide in the menu.
const optionProductName = `كابتشينو ${runId}`; // HAS options (picker path)
const optionName = `حليب اللوز ${runId}`; //      +0.250
const optionGroupName = `النوع ${runId}`; //  the option group it lives in
const plainProductName = `شاي ${runId}`; //      plain (quick-add path)
const optionPrice = 0.25;
const plainPrice = 0.75;
const optionProductPrice = 1.25; // unit with the variety = 1.500

type OrderRow = {
  id: string;
  status: string;
  total_amount: number;
  order_number: number;
  type: string;
  service_type: string | null;
  order_items: {
    product_name: string;
    quantity: number;
    unit_price: number;
    addons: { name: string; price: number }[];
  }[];
};

let userId: string;
let projectId: string;
let otherProjectId: string;
let optionProductId: string;
let plainProductId: string;
let optionId: string;

let cust: Page; // the diner's phone — kept across every step
let custCtx: BrowserContext;
let api: APIRequestContext;
let menu2: Page | null = null; // second phone, used by the sold-out + empty-cart steps

let orderId = '';
let orderNumber = 0;

/** «1.500 BHD» → 1.5. Money is compared numerically (toBeCloseTo), never as a
 *  string, so a locale/grouping change in formatMoney can't fail the test. */
function parseMoney(text: string | null | undefined): number {
  return Number((text ?? '').replace(/[^\d.]/g, ''));
}

const totalOf = (unit: number, qty: number) => unit * qty;
const optionUnit = () => optionProductPrice + optionPrice; // 1.500
/** Two capuccinos + one tea. */
const expectedTotal = () => totalOf(optionUnit(), 2) + totalOf(plainPrice, 1); // 3.750

/** The «الإجمالي» row in the cart sheet — read the value next to the label. */
async function cartTotal(page: Page): Promise<{ raw: string; value: number }> {
  const label = page.getByRole('dialog', { name: 'سلتك' }).getByText('الإجمالي', { exact: true });
  const raw = (await label.locator('xpath=following-sibling::span').first().textContent()) ?? '';
  return { raw, value: parseMoney(raw) };
}

async function orderStatusOf(id: string, projectSlug: string): Promise<{ status: number; body: unknown }> {
  const res = await api.get(
    `/api/public/order-status?orderId=${encodeURIComponent(id)}&projectSlug=${encodeURIComponent(projectSlug)}`
  );
  return { status: res.status(), body: await res.json().catch(() => null) };
}

/** The public menu is ISR-cached per project (`unstable_cache`, tag
 *  `menu-${projectId}`). The test purges that tag through the very endpoint the
 *  dashboard uses, but the page render itself can still be a beat behind, so
 *  re-navigate until the expectation holds instead of sleeping blindly. */
async function gotoUntil(page: Page, urlPath: string, locator: Locator, timeoutMs: number) {
  const deadline = Date.now() + timeoutMs;
  let lastError: unknown = null;
  while (Date.now() < deadline) {
    await page.goto(urlPath, { waitUntil: 'domcontentloaded' });
    try {
      await locator.waitFor({ state: 'visible', timeout: 6_000 });
      return;
    } catch (err) {
      lastError = err;
    }
  }
  throw new Error(`menu never reflected the change: ${urlPath}\n${String(lastError)}`);
}

test.beforeAll(async ({ browser, playwright }) => {
  // ---- Isolated store, seeded straight through the service role ------------
  const user = await createTestUser(email);
  userId = user.id;

  const { data: proj, error: pErr } = await admin
    .from('projects')
    .insert({ name: storeName, slug, currency: 'BHD', primary_color: '#4338CA', is_active: true })
    .select('id')
    .single();
  if (pErr || !proj) throw new Error(`seed project: ${pErr?.message}`);
  projectId = proj.id;

  const { error: sErr } = await admin
    .from('staff_members')
    .insert({ project_id: projectId, user_id: userId, role: 'owner' });
  if (sErr) throw new Error(`seed staff: ${sErr.message}`);

  const { data: cat, error: cErr } = await admin
    .from('categories')
    .insert({ project_id: projectId, name: categoryName, sort_order: 0, is_active: true })
    .select('id')
    .single();
  if (cErr || !cat) throw new Error(`seed category: ${cErr?.message}`);

  const { data: prod1, error: e1 } = await admin
    .from('products')
    .insert({
      project_id: projectId,
      name: optionProductName,
      price: optionProductPrice,
      category_id: cat.id,
      is_available: true,
      sort_order: 1,
    })
    .select('id')
    .single();
  if (e1 || !prod1) throw new Error(`seed product 1: ${e1?.message}`);
  optionProductId = prod1.id;

  const { data: prod2, error: e2 } = await admin
    .from('products')
    .insert({
      project_id: projectId,
      name: plainProductName,
      price: plainPrice,
      category_id: cat.id,
      is_available: true,
      sort_order: 2,
    })
    .select('id')
    .single();
  if (e2 || !prod2) throw new Error(`seed product 2: ${e2?.message}`);
  plainProductId = prod2.id;

  // One OPTIONAL single-choice group holding the priced variety. Optional on
  // purpose: it keeps the "add to cart" button enabled from the start, so the
  // test exercises the picker without depending on required-group gating.
  const { data: optGroup, error: gErr } = await admin
    .from('option_groups')
    .insert({ product_id: optionProductId, name: optionGroupName, min_select: 0, max_select: 1, sort_order: 0 })
    .select('id')
    .single();
  if (gErr || !optGroup) throw new Error(`seed option group: ${gErr?.message}`);

  const { data: optChoice, error: aErr } = await admin
    .from('option_choices')
    .insert({ group_id: optGroup.id, name: optionName, price: optionPrice, is_available: true, sort_order: 0 })
    .select('id')
    .single();
  if (aErr || !optChoice) throw new Error(`seed option variety: ${aErr?.message}`);
  optionId = optChoice.id;

  const { error: tErr } = await admin
    .from('tables')
    .insert({ project_id: projectId, number: 1, slug: 'table-1', is_active: true, qrcode: TABLE_TOKEN });
  if (tErr) throw new Error(`seed table: ${tErr.message}`);

  // Cross-tenant fixture for the order-status probe. No owner, no menu.
  const { data: other, error: oErr } = await admin
    .from('projects')
    .insert({ name: `متجر آخر ${runId}`, slug: otherSlug, currency: 'BHD', primary_color: '#4338CA', is_active: true })
    .select('id')
    .single();
  if (oErr || !other) throw new Error(`seed other project: ${oErr?.message}`);
  otherProjectId = other.id;

  // ---- A real phone: same viewport as the config, plus touch ---------------
  custCtx = await browser.newContext({
    baseURL: E2E_BASE_URL,
    viewport: { width: 390, height: 844 },
    isMobile: true,
    hasTouch: true,
    locale: 'ar-BH',
  });
  cust = await custCtx.newPage();
  api = await playwright.request.newContext({ baseURL: E2E_BASE_URL });
});

test.afterAll(async () => {
  await menu2?.close().catch(() => {});
  await custCtx?.close().catch(() => {});
  await api?.dispose().catch(() => {});
  // The cross-tenant fixture has no staff_members row, so cleanupTestUser
  // cannot see it — drop it explicitly. daily_order_counters / order_audit_logs
  // cascade with the project; rate_limits are keyed by slug string, not FK.
  if (otherProjectId) await admin.from('projects').delete().eq('id', otherProjectId);
  for (const s of [slug, otherSlug]) {
    await admin.from('rate_limits').delete().ilike('key', `%${s}%`);
  }
  await cleanupTestUser(email);
});

/* ====================================================================== *
 * 1. SCAN THE TABLE QR CODE
 * ====================================================================== */
test('1. scanning the table QR opens the store menu with the seeded products', async () => {
  // The QR on a table encodes exactly this path — no login, no dashboard.
  const resp = await cust.goto(`/${slug}/menu/table-1?k=${TABLE_TOKEN}`);
  expect(resp?.status()).toBe(200);

  // Store identity in the header.
  await expect(cust.getByRole('heading', { name: storeName, level: 1 })).toBeVisible({ timeout: 25_000 });
  // «طاولة» + padStart(2,'0') in a dir="ltr" span → «طاولة 01». Both live in
  // the SAME element (menu-client.tsx: `{label} <span dir="ltr">{n}</span>`), so
  // there is no element whose text is exactly «طاولة» — matching it alone made
  // this assertion unsatisfiable. Assert the joined text instead.
  const tableChip = cust.locator('span[dir="ltr"]').filter({ hasText: /^0?1$/ }).first();
  await expect(tableChip).toBeVisible();
  await expect(cust.getByText(/^طاولة\s*0?1$/)).toBeVisible();
  // Category heading + both products are on the page.
  await expect(cust.getByText(categoryName).first()).toBeVisible();
  await expect(cust.getByText(optionProductName).first()).toBeVisible();
  await expect(cust.getByText(plainProductName).first()).toBeVisible();
  // Nothing sold out yet, and an empty cart shows no cart bar.
  await expect(cust.getByText('غير متوفر')).toHaveCount(0);
  await expect(cust.getByRole('button').filter({ hasText: 'إتمام الطلب' })).toHaveCount(0);
  await expect(cust.getByRole('button', { name: 'تأكيد الطلب', exact: true })).toHaveCount(0);
});

/* ====================================================================== *
 * 2. BUILD THE CART
 * ====================================================================== */
test('2. two different products (one with options) → qty controls → total = sum(unit × qty)', async () => {
  // --- 2a. The product with options opens the picker -------------------------
  await cust.locator(`[aria-label="إضافة ${optionProductName} إلى السلة"]`).first().click();
  const picker = cust.getByRole('dialog', { name: optionProductName });
  await expect(picker).toBeVisible({ timeout: 15_000 });
  // The variety row shows its own price: `+{formatMoney(price)}`.
  await expect(picker.getByText('+0.250 BHD')).toBeVisible();
  // A variety is an ARIA control on a BUTTON now (groups replaced the flat addon
  // list): role=radio when the group is single-choice, checkbox when multiple.
  // This group is max_select=1, so it renders as a radio. Assert the ARIA state
  // rather than an <input> property.
  const variety = picker.getByRole('radio', { name: new RegExp(optionName) });
  await expect(variety).toHaveAttribute('aria-checked', 'false');
  await variety.click();
  await expect(variety).toHaveAttribute('aria-checked', 'true');
  await picker.getByRole('button', { name: 'أضف إلى السلة' }).click();

  // The first add auto-opens the cart sheet.
  const cart = cust.getByRole('dialog', { name: 'سلتك' });
  await expect(cart).toBeVisible({ timeout: 20_000 });
  await expect(cart.getByText(optionProductName)).toBeVisible();
  await expect(cart.getByText(optionName)).toBeVisible();
  // unit_price is price + options, so the LINE already carries the option.
  // `[last()]` not `[1]`: the name <p> is followed by the options <p> and then
  // the notes <p>, so the price is only ever the LAST sibling <p>.
  const oneLine = await cart
    .getByText(optionProductName)
    .locator('xpath=following-sibling::p[last()]')
    .textContent();
  expect(parseMoney(oneLine), `line price must be product + option (got ${oneLine})`).toBeCloseTo(optionUnit(), 3);
  const afterFirst = await cartTotal(cust);
  expect(afterFirst.raw).toContain('BHD');
  expect(afterFirst.value).toBeCloseTo(optionUnit(), 3);

  // --- 2b. Close the sheet, add the PLAIN product (quick-add) --------------
  await cart.getByRole('button', { name: 'إغلاق' }).click();
  await expect(cart).toBeHidden();
  await cust.locator(`[aria-label="إضافة ${plainProductName} إلى السلة"]`).first().click();
  const cartBar = cust.getByRole('button').filter({ hasText: 'إتمام الطلب' });
  await expect(cartBar).toBeVisible({ timeout: 15_000 });
  await expect(cartBar.getByText('السلة')).toBeVisible();
  // Read the money span itself, NOT the button's whole textContent: the bar
  // also contains the item count («السلة 2»), and parseMoney strips every
  // non-numeric character, so «السلة 2 … 2.250 BHD» collapsed to 22.250 and
  // produced a 20.000 phantom. The total is the span marked dir="ltr"
  // (menu-client.tsx:701) that is NOT the cart badge/count.
  const barTotal = cartBar.locator('span[dir="ltr"]').last();
  const barText = (await barTotal.textContent()) ?? '';
  expect(parseMoney(barText), `floating cart bar total (got «${barText}»)`).toBeCloseTo(optionUnit() + plainPrice, 3);
  // A later add only toasts — the sheet must NOT steal focus back.
  await expect(cust.getByRole('dialog', { name: 'سلتك' })).toHaveCount(0);

  // --- 2c. Increase the option line from the cart sheet's stepper ---------
  await cartBar.click();
  await expect(cart).toBeVisible({ timeout: 15_000 });
  await expect(cart.getByText(plainProductName)).toBeVisible();
  const before = await cartTotal(cust);
  expect(before.value).toBeCloseTo(optionUnit() + plainPrice, 3);

  await cart.getByRole('button', { name: 'زيادة الكمية' }).first().click();
  const after = await cartTotal(cust);
  // +1 × 1.500 — the stepper must multiply the option-inclusive unit price.
  expect(after.value).toBeCloseTo(before.value + optionUnit(), 3);
  expect(after.value).toBeCloseTo(expectedTotal(), 3);
  // The floating bar agrees with the sheet.
  await expect(cartBar).toContainText(`${expectedTotal().toFixed(3)}`);
});

/* ====================================================================== *
 * 3. SUBMIT
 * ====================================================================== */
test('3. submitting shows the success screen and hands back the order id + number', async () => {
  const cart = cust.getByRole('dialog', { name: 'سلتك' });
  await expect(cart).toBeVisible({ timeout: 20_000 });

  const posted = cust.waitForResponse(
    (r) => r.url().includes('/api/public/order') && r.request().method() === 'POST'
  );
  await cart.getByRole('button', { name: 'تأكيد الطلب', exact: true }).click();
  const res = await posted;
  expect(res.status(), await res.text().catch(() => '')).toBe(200);
  const body = (await res.json()) as { order: { id: string; orderNumber: number; totalAmount: number } };
  orderId = body.order.id;
  orderNumber = body.order.orderNumber;
  expect(orderId, 'order id must come back').toBeTruthy();
  expect(orderNumber).toBeGreaterThan(0);
  // The server priced it, not the browser.
  expect(Number(body.order.totalAmount)).toBeCloseTo(expectedTotal(), 3);

  // Success screen: heading + the order number rendered from the response.
  await expect(cust.getByRole('heading', { name: 'تم استلام طلبك' })).toBeVisible({ timeout: 25_000 });
  const domNumberText = (await cust.locator('span[dir="ltr"]').filter({ hasText: 'order-' }).first().textContent()) ?? '';
  const domNumber = Number(domNumberText.match(/order-(\d+)/)?.[1]);
  expect(domNumber, 'order number is on the success screen').toBe(orderNumber);
  // Server total is what the customer is shown. Scope it to the success screen
  // (`min-h-dvh` root) so the transient «أُضيف إلى السلة» toast, which renders
  // the same formatted number, can never be what we read.
  const shownTotalText =
    (await cust.locator('div.min-h-dvh').getByText(`${expectedTotal().toFixed(3)} BHD`).first().textContent()) ?? '';
  expect(parseMoney(shownTotalText), `success total was "${shownTotalText}"`).toBeCloseTo(expectedTotal(), 3);

  // DB truth: 2 lines, quantities 2 and 1, unit prices already include the option.
  const { data } = await admin
    .from('orders')
    .select('id, status, total_amount, order_number, type, service_type, order_items(product_name, quantity, unit_price, addons)')
    .eq('id', orderId)
    .single();
  const order = data as OrderRow | null;
  expect(order, 'order row must exist').toBeTruthy();
  expect(order!.status).toBe('pending');
  expect(order!.order_number).toBe(orderNumber);
  expect(order!.type).toBe('dinein');
  // NOT a waiter/bill service row.
  expect(order!.service_type).toBeNull();
  expect(Number(order!.total_amount)).toBeCloseTo(expectedTotal(), 3);
  expect(order!.order_items).toHaveLength(2);

  const capLine = order!.order_items.find((i) => i.product_name === optionProductName)!;
  const teaLine = order!.order_items.find((i) => i.product_name === plainProductName)!;
  expect(capLine.quantity).toBe(2);
  expect(teaLine.quantity).toBe(1);
  expect(Number(capLine.unit_price)).toBeCloseTo(optionUnit(), 3);
  expect(Number(teaLine.unit_price)).toBeCloseTo(plainPrice, 3);
  expect(capLine.addons).toHaveLength(1);
  expect(capLine.addons[0].name).toBe(optionName);
  expect(Number(capLine.addons[0].price)).toBeCloseTo(optionPrice, 3);
  expect(teaLine.addons).toHaveLength(0);
});

/* ====================================================================== *
 * 4. LIVE ORDER STATUS
 * ====================================================================== */
test('4. the order moves pending → preparing → ready → delivered, and order-status is tenant-scoped', async () => {
  test.setTimeout(180_000);
  const statusUrl = (projectSlug: string) =>
    `/api/public/order-status?orderId=${encodeURIComponent(orderId)}&projectSlug=${encodeURIComponent(projectSlug)}`;

  // 4a. A customer must NOT be able to fast-forward their own order. The
  //     endpoint needs no auth, so the RPC guard is the only line of defence.
  //     Do NOT assert a specific Postgres code here: depending on the grant,
  //     PostgREST surfaces this either as 42501 (membership guard) or as
  //     404/PGRST202 (function not exposed to anon) — both are refusals, and
  //     only the DB truth below is the behaviour that matters.
  const anon = createClient(url, anonKey(), { auth: { persistSession: false, autoRefreshToken: false } });
  const forged = await anon.rpc('advance_order_status', {
    p_order_id: orderId,
    p_expected_status: 'pending',
    p_new_status: 'delivered',
    p_caller_user_id: null,
  });
  expect(forged.data, 'an anonymous caller must not advance an order').toBeFalsy();
  const { data: stillPending } = await admin.from('orders').select('status').eq('id', orderId).single();
  expect(stillPending?.status, `anon RPC error was: ${forged.error?.message ?? 'none'}`).toBe('pending');

  // 4b. Freshly placed order reads as pending.
  const first = await orderStatusOf(orderId, slug);
  expect(first.status).toBe(200);
  expect((first.body as { status: string }).status).toBe('pending');

  // 4c. The kitchen advances it — the exact RPC the KDS calls, driven through
  //     the service role with the owner as the (membership-checked) caller.
  const advance = (from: string, to: string) =>
    admin.rpc('advance_order_status', {
      p_order_id: orderId,
      p_expected_status: from,
      p_new_status: to,
      p_caller_user_id: userId,
    });

  // OWNER REPORT 2026-10-06: the customer's status screen lagged the kitchen.
  // Measured from the instant the staff write COMMITS to the moment the customer
  // can read the new stage — nothing else is allowed inside the window, so the
  // number is the real customer-visible lag. The screen polls every 2.5s here, so
  // the worst case is one full tick plus one fetch and one render; before the fix
  // the tick was 12s, which is why this same assertion used to fail.
  const r1 = await advance('pending', 'preparing');
  expect(r1.error, `pending→preparing: ${r1.error?.message}`).toBeNull();

  const t0 = Date.now();
  await expect(cust.getByText('طلبك قيد التحضير — يتم تحديث الحالة تلقائيًا')).toBeVisible({
    timeout: 15_000,
  });
  const lagMs = Date.now() - t0;
  // Printed on success too: the owner's bar is a measured number, not a green tick.
  console.log(`[latency] customer saw «قيد التحضير» ${lagMs}ms after the kitchen advanced the order`);
  expect(
    lagMs,
    `the customer saw «قيد التحضير» ${lagMs}ms after the kitchen advanced the order (3s cadence)`
  ).toBeLessThan(5000);

  await expect
    .poll(async () => ((await orderStatusOf(orderId, slug)).body as { status: string }).status, { timeout: 20_000 })
    .toBe('preparing');

  const r2 = await advance('preparing', 'ready');
  expect(r2.error, `preparing→ready: ${r2.error?.message}`).toBeNull();
  await expect
    .poll(async () => ((await orderStatusOf(orderId, slug)).body as { status: string }).status, { timeout: 20_000 })
    .toBe('ready');

  // The customer is watching the same order on the still-open success screen:
  // its 12s poll must catch up to the terminal step.
  await expect(cust.getByText('طلبك جاهز')).toBeVisible({ timeout: 40_000 });
  for (const step of ['قيد الانتظار', 'قيد التحضير', 'جاهز']) {
    await expect(cust.getByText(step, { exact: true })).toBeVisible();
  }

  const r3 = await advance('ready', 'delivered');
  expect(r3.error, `ready→delivered: ${r3.error?.message}`).toBeNull();
  await expect
    .poll(async () => ((await orderStatusOf(orderId, slug)).body as { status: string }).status, { timeout: 20_000 })
    .toBe('delivered');

  // 4d. Cross-tenant: the SAME order id under a DIFFERENT store's slug must be
  //     a 404, never the status.
  const foreign = await api.get(statusUrl(otherSlug));
  expect(foreign.status(), 'a foreign project slug must not resolve this order').toBe(404);
  expect((await foreign.json()) as { error: string }).toMatchObject({ error: 'غير موجود' });

  // ...and the owner's own slug still answers, so the 404 above is the tenant
  // guard, not a broken endpoint.
  const own = await orderStatusOf(orderId, slug);
  expect(own.status).toBe(200);
  expect((own.body as { status: string }).status).toBe('delivered');

  // Malformed id is a clean 400, not a 500.
  const junk = await api.get('/api/public/order-status?orderId=not-a-uuid&projectSlug=' + slug);
  expect(junk.status()).toBe(400);
});

/* ====================================================================== *
 * 5. SOLD-OUT / UNAVAILABLE PRODUCT
 * ====================================================================== */
test('5. a sold-out product cannot be added to the cart and orders for it 400 (not 500)', async () => {
  test.setTimeout(180_000);

  // The merchant marks the tea unavailable…
  const { data: updated, error: uErr } = await admin
    .from('products')
    .update({ is_available: false })
    .eq('id', plainProductId)
    .select('id, is_available')
    .single();
  if (uErr) throw new Error(`mark sold out: ${uErr.message}`);
  expect(updated?.is_available).toBe(false);

  // …which purges the project menu cache through the same endpoint the
  // dashboard's product form calls (POST /api/revalidate-menu, owner session).
  // Best-effort by design: the purge only shortens the wait, it is not the
  // behaviour under test, and `gotoUntil` below re-navigates until the change
  // is visible either way (the menu query has a 60s unstable_cache window).
  const cookies = await getAuthCookies(email, TEST_PASSWORD);
  const purge = await api.post('/api/revalidate-menu', {
    data: { projectId },
    headers: { Cookie: cookies.map((c) => `${c.name}=${c.value}`).join('; ') },
  });
  console.log(`ℹ menu cache purge → ${purge.status()}`);

  // A second phone opens the menu again (the first one is parked on the
  // success screen for step 7).
  menu2 = await custCtx.newPage();
  const soldOut = menu2.getByText('غير متوفر');
  await gotoUntil(menu2, `/${slug}/menu/table-1?k=${TABLE_TOKEN}`, soldOut, 60_000);

  // Still listed (a shrinking menu confuses customers) but not orderable:
  // the add circle is replaced by an X and the card button is aria-disabled.
  await expect(menu2.getByText(plainProductName).first()).toBeVisible();
  await expect(soldOut.first()).toBeVisible();
  await expect(menu2.locator(`[aria-label="إضافة ${plainProductName} إلى السلة"]`)).toHaveCount(0);
  // The badge sits INSIDE the card button, so its accessible name also contains
  // «غير متوفر» — assert on the accessible name, not on a CSS attribute.
  const soldOutCard = menu2.getByRole('button', { name: `${plainProductName} — غير متوفر` });
  await expect(soldOutCard).toHaveCount(1);
  await expect(soldOutCard).toHaveAttribute('aria-disabled', 'true');

  // Clicking the sold-out card does nothing at all — no cart, no new order.
  //
  // The card is `aria-disabled`, not `disabled`: it must stay reachable for
  // screen readers, and Playwright's actionability check treats an
  // aria-disabled target as "not enabled" and retries forever. So we cannot
  // `click()` it — the honest equivalent of a user's tap is a forced click at
  // the element's own coordinates, which still dispatches a real event to it.
  const ordersBeforeClick = await admin
    .from('orders')
    .select('id', { count: 'exact', head: true })
    .eq('project_id', projectId);
  await soldOutCard.click({ force: true });
  await expect(menu2.getByRole('button').filter({ hasText: 'إتمام الطلب' })).toHaveCount(0);
  await expect(menu2.getByRole('dialog', { name: 'سلتك' })).toHaveCount(0);
  const ordersAfterClick = await admin
    .from('orders')
    .select('id', { count: 'exact', head: true })
    .eq('project_id', projectId);
  expect(ordersAfterClick.count, 'a sold-out tap must not create anything').toBe(ordersBeforeClick.count);

  // The server refuses too — and refuses CLEANLY.
  const bad = await api.post('/api/public/order', {
    data: {
      projectSlug: slug,
      tableSlug: 'table-1',
      tableToken: TABLE_TOKEN,
      items: [{ productId: plainProductId, quantity: 1 }],
    },
  });
  expect(bad.status(), await bad.text().catch(() => '')).toBe(400);
  expect(await bad.json()).toMatchObject({ error: 'منتج غير متاح أو لا ينتمي لهذا المتجر' });
  // A rejected line must not have created a partial order.
  const after = await admin
    .from('orders')
    .select('id', { count: 'exact', head: true })
    .eq('project_id', projectId);
  expect(after.count).toBe(ordersBeforeClick.count);

  // The still-available product with options still orders fine.
  const good = await api.post('/api/public/order', {
    data: {
      projectSlug: slug,
      tableSlug: 'table-1',
      tableToken: TABLE_TOKEN,
      items: [{ productId: optionProductId, quantity: 1, optionIds: [optionId] }],
    },
  });
  expect(good.status(), await good.text().catch(() => '')).toBe(200);
  const goodBody = (await good.json()) as { order: { totalAmount: number } };
  expect(Number(goodBody.order.totalAmount)).toBeCloseTo(optionUnit(), 3);
});

/* ====================================================================== *
 * 6. EMPTY CART CANNOT SUBMIT
 * ====================================================================== */
test('6. an empty cart has no confirm button, and a emptied cart disables it', async () => {
  const page = menu2!;
  // A fresh menu visit: no cart, so no cart bar and no confirm button at all.
  await page.goto(`/${slug}/menu/table-1?k=${TABLE_TOKEN}`, { waitUntil: 'domcontentloaded' });
  await expect(page.getByText(plainProductName).first()).toBeVisible({ timeout: 30_000 });
  await expect(page.getByRole('button', { name: 'تأكيد الطلب', exact: true })).toHaveCount(0);
  await expect(page.getByRole('button').filter({ hasText: 'إتمام الطلب' })).toHaveCount(0);

  // Now the harder case: the cart is OPEN but the customer removed the last
  // line — the confirm button stays rendered and must be disabled.
  await page.locator(`[aria-label="إضافة ${optionProductName} إلى السلة"]`).first().click();
  const picker = page.getByRole('dialog', { name: optionProductName });
  await expect(picker).toBeVisible({ timeout: 15_000 });
  await picker.getByText(optionName, { exact: true }).click();
  await picker.getByRole('button', { name: 'أضف إلى السلة' }).click();

  const cart = page.getByRole('dialog', { name: 'سلتك' });
  await expect(cart).toBeVisible({ timeout: 20_000 });
  const confirm = cart.getByRole('button', { name: 'تأكيد الطلب', exact: true });
  await expect(confirm).toBeEnabled();

  await cart.getByRole('button', { name: 'إنقاص الكمية' }).first().click(); // line removed (qty hits 0)
  await expect(cart.getByText(optionProductName)).toHaveCount(0);
  await expect(confirm).toBeDisabled();

  // Total is exactly zero — Object.is, because -0 and 0 must not both pass.
  const emptied = await cartTotal(page);
  expect(Object.is(emptied.value, 0), `emptied cart total was ${emptied.raw}`).toBe(true);
  expect(emptied.raw).toContain('BHD');

  // And the cart bar is gone, so there is no second path to checkout.
  await expect(page.getByRole('button').filter({ hasText: 'إتمام الطلب' })).toHaveCount(0);
});

/* ====================================================================== *
 * 7. FINAL STATE ON THE STATUS SCREEN
 * ====================================================================== */
test('7. the completed order’s status screen shows the final state', async () => {
  // Same page, same client state: the success screen the diner is still on.
  await expect(cust.getByRole('heading', { name: 'تم استلام طلبك' })).toBeVisible({ timeout: 30_000 });
  await expect(cust.getByText('طلبك جاهز')).toBeVisible();
  // The polling bar is NOT in its error state (the "lost" branch).
  await expect(cust.getByText('تعذّر تحديث الحالة')).toHaveCount(0);
  await expect(cust.getByText('يتم تحديث الحالة تلقائيًا')).toHaveCount(0);
  // The diner can still reach the two service actions from here.
  await expect(cust.getByRole('button', { name: 'طلب موظف' })).toBeVisible();
  await expect(cust.getByRole('button', { name: 'طلب الفاتورة' })).toBeVisible();

  // The state behind the screen is final and atomic: order delivered, every
  // line item moved with it (the RPC advances items up to 'ready').
  const { data } = await admin
    .from('orders')
    .select('status, order_items(status)')
    .eq('id', orderId)
    .single();
  const final = data as { status: string; order_items: { status: string }[] } | null;
  expect(final?.status).toBe('delivered');
  expect(final?.order_items.length).toBeGreaterThan(0);
  expect(final?.order_items.every((i) => i.status === 'ready')).toBe(true);

  // The public endpoint agrees with the database.
  const seen = await orderStatusOf(orderId, slug);
  expect(seen.status).toBe(200);
  expect((seen.body as { status: string }).status).toBe('delivered');

  console.log(`✅ CUSTOMER JOURNEY OK — order #${orderNumber} (${orderId}) delivered, store ${slug} torn down next`);
});
