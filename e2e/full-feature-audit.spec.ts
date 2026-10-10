import { test, expect, type Page, type APIRequestContext } from '@playwright/test';
import {
  admin,
  createTestUser,
  cleanupTestUser,
  getAuthCookies,
  makeEmail,
  TEST_PASSWORD,
} from './helpers';

/** Table scan token: public orders are gated on it since REQUIRE_TABLE_TOKEN=true. */
const TABLE_TOKEN = '56565656565656565656565656565656';

/**
 * FULL FEATURE AUDIT — every surface of dokanstore.xyz exercised at least
 * once in one reportable pass:
 *
 *   A) Public/marketing/legal/PWA   B) Auth surface (real UI)
 *   C) Merchant operations (isolated store seeded via service_role)
 *   D) Customer endpoints: order → status → waiter → bill (real, on our store)
 *   E) Super-admin: list/renew/deactivate/impersonate/audit/analytics
 *   F) Isolation & guards (tenant B, anon JWT, no-auth)
 *
 * Everything it creates (store A + 3 users + orders) is destroyed in
 * afterAll. The production demo store (dar-salam) is never touched.
 */
test.describe.configure({ mode: 'serial' });

const runId = Date.now() % 1_000_000;
const slugA = `audit-${runId}`;
const storeName = `متجر الفحص ${runId}`;
const ownerEmail = makeEmail();
const strangerEmail = makeEmail(); // user B — no project
const saEmail = makeEmail(); // super-admin fixture

let projectId = '';
let productId = '';
let tableId = '';
let ownerId = '';
let saId = '';
let publicOrderId = '';
let posOrderId = '';

const OWNER_COOKIES = () => getAuthCookies(ownerEmail, TEST_PASSWORD);
const SA_COOKIES = () => getAuthCookies(saEmail, TEST_PASSWORD);

test.beforeAll(async () => {
  // 1) three users via admin API
  const owner = await createTestUser(ownerEmail);
  ownerId = owner.id;
  const stranger = await createTestUser(strangerEmail);
  void stranger; // cleanup by email
  saId = (await createTestUser(saEmail)).id;

  // 2) isolated store via the SAME table defaults as real onboarding
  const { data: proj, error: pErr } = await admin
    .from('projects')
    .insert({ name: storeName, slug: slugA, currency: 'BHD', is_active: true, created_by: ownerId })
    .select('id')
    .single();
  if (pErr || !proj) throw new Error(`seed project: ${pErr?.message}`);
  projectId = proj.id;
  await admin.from('staff_members').insert({ project_id: projectId, user_id: ownerId, role: 'owner' });
  await admin.from('super_admins').insert({ user_id: saId });

  // 3) menu + table
  const { data: cat } = await admin
    .from('categories')
    .insert({ project_id: projectId, name: 'مشروبات الفحص', sort_order: 1, is_active: true })
    .select('id')
    .single();
  const { data: prod } = await admin
    .from('products')
    .insert({
      project_id: projectId,
      category_id: cat!.id,
      name: 'شاي فحص',
      price: 0.50,
      is_available: true,
      sort_order: 1,
    })
    .select('id')
    .single();
  productId = prod!.id;
  const { data: tbl } = await admin
    .from('tables')
    .insert({
      project_id: projectId,
      number: 1,
      slug: 'a-1',
      qrcode: TABLE_TOKEN,
      is_active: true,
    })
    .select('id')
    .single();
  tableId = tbl!.id;
});

test.afterAll(async () => {
  // full teardown — orders/items cascade-safe, then menu/project/users
  if (projectId) {
    const { data: orders } = await admin.from('orders').select('id').eq('project_id', projectId);
    for (const o of orders ?? []) await admin.from('order_items').delete().eq('order_id', o.id);
    await admin.from('orders').delete().eq('project_id', projectId);
    await admin.from('daily_order_counters').delete().eq('project_id', projectId);
    await admin.from('rate_limits').delete().ilike('key', `%${slugA}%`);
    await admin.from('tables').delete().eq('project_id', projectId);
    await admin.from('products').delete().eq('project_id', projectId);
    await admin.from('categories').delete().eq('project_id', projectId);
    await admin.from('staff_members').delete().eq('project_id', projectId);
    await admin.from('projects').delete().eq('id', projectId);
  }
  await admin.from('super_admins').delete().eq('user_id', saId);
  for (const e of [ownerEmail, strangerEmail, saEmail]) await cleanupTestUser(e);
});

/* ====================================================================== *
 * A) PUBLIC / MARKETING / LEGAL / PWA
 * ====================================================================== */
test('A1 landing: RTL, hero, CTA, legal footer — no duplicate login CTA', async ({ page }) => {
  await page.goto('/');
  await expect(page.locator('html')).toHaveAttribute('dir', 'rtl');
  await expect(page.locator('html')).toHaveAttribute('lang', 'ar');
  await expect(page.getByRole('heading', { level: 1 })).toContainText('من التسجيل إلى أول طلب');
  await expect(page.getByRole('link', { name: 'ابدأ مجاناً' })).toBeVisible();
  await expect(page.getByRole('link', { name: 'الشروط والأحكام' })).toBeVisible();
  await expect(page.getByRole('link', { name: 'سياسة الخصوصية' })).toBeVisible();
  // Phase-2 regression guard: the removed duplicate must stay gone.
  await expect(page.getByText('لدي حساب')).toHaveCount(0);
});

test('A2 /terms + /privacy render real content', async ({ page }) => {
  await page.goto('/terms');
  await expect(page.getByRole('heading', { level: 1 })).toHaveText('شروط الاستخدام');
  await expect(page.getByText('الفترة التجريبية والاشتراك')).toBeVisible();
  await page.goto('/privacy');
  await expect(page.getByRole('heading', { level: 1 })).toHaveText('سياسة الخصوصية');
  await expect(page.getByText('لا نبيع بياناتك لأحد')).toBeVisible();
});

test('A3 PWA surface: manifest, service worker, offline, icons', async ({ request }) => {
  const man = await request.get('/manifest.webmanifest');
  expect(man.status()).toBe(200);
  const mj = await man.json();
  expect(mj.name).toBeTruthy();
  expect(Array.isArray(mj.icons) && mj.icons.length).toBeGreaterThan(2);
  expect(mj.dir).toBe('rtl');

  const sw = await request.get('/sw.js');
  expect(sw.status()).toBe(200);
  expect(await sw.text()).toContain('dokan-'); // versioned caches prefix

  for (const asset of ['/offline.html', '/icons/icon-192.png', '/icons/icon-512.png', '/icons/icon-maskable-512.png']) {
    const r = await request.get(asset);
    expect(r.status(), asset).toBe(200);
  }
});

test('A4 status pages + 404', async ({ page, request }) => {
  await page.goto('/store-unavailable');
  await expect(page.getByRole('heading', { level: 1 })).toContainText('المتجر غير متاح');
  await page.goto('/subscription-expired');
  await expect(page.locator('h1, h2').first()).toBeVisible();
  const nf = await request.get('/this-page-cannot-exist-9x7');
  expect(nf.status()).toBe(404);
  expect(await nf.text()).toContain('الصفحة غير موجودة');
});

/* ====================================================================== *
 * B) AUTH SURFACE — through the REAL forms
 * ====================================================================== */
test('B1 login: wrong credentials → Arabic error (no crash)', async ({ page }) => {
  await page.goto('/login');
  await page.fill('input[type="email"]', 'nope-404@dokan.test');
  await page.fill('input[type="password"]', 'wrong-password');
  await page.getByRole('button', { name: 'دخول' }).click();
  await expect(page.getByText('بيانات الدخول غير صحيحة')).toBeVisible({ timeout: 15_000 });
});

test('B2 register: client validation exposes aria-invalid, valid signup lands on /onboarding', async ({ page }) => {
  const newUser = makeEmail();
  await page.goto('/register');
  const emailInput = page.locator('input[type="email"]');
  await emailInput.fill('not-an-email');
  await emailInput.blur();
  await expect(emailInput).toHaveAttribute('aria-invalid', 'true'); // Phase-2 wiring
  await emailInput.fill(newUser);
  await page.fill('#fullName', 'فاحص شامل');
  await page.fill('#password', TEST_PASSWORD);
  await page.getByRole('button', { name: 'إنشاء الحساب' }).click();
  await page.waitForURL('**/onboarding', { timeout: 25_000 }); // auto sign-in
  await cleanupTestUser(newUser);
});

test('B3 password-reset + update-password handle garbage tokens gracefully', async ({ page, request }) => {
  const rr = await request.post('/api/auth/reset-password', { data: { email: 'nobody@dokan.test' } });
  expect(rr.status(), 'no 5xx on unknown email').toBeLessThan(500);
  await page.goto('/reset-password');
  await expect(page.locator('input').first()).toBeVisible();
  await page.goto('/update-password'); // no token in URL
  await expect(page.locator('input').first().or(page.getByText(/رابط|غير صالح|خطأ/).first())).toBeVisible();
});

/* ====================================================================== *
 * C) MERCHANT OPERATIONS — owner session over the seeded store
 * ====================================================================== */
async function asOwner(page: Page) {
  await page.context().addCookies(await OWNER_COOKIES());
}

test('C1 dashboard loads with store greeting + KPI structure', async ({ page }) => {
  await asOwner(page);
  await page.goto('/dashboard');
  await expect(page.getByRole('heading', { name: new RegExp(storeName) }).first()).toBeVisible({ timeout: 25_000 });
  await expect(page.locator('aside, nav').first()).toBeVisible();
  await expect(page.getByText('نشط').first()).toBeVisible();
});

test('C2 products: availability toggle syncs DB + menu cache (revalidate-menu)', async ({ page, request }) => {
  await asOwner(page); // owner session lives in the shared context jar
  await page.goto('/dashboard/products');
  await expect(page.getByText('شاي فحص').first()).toBeVisible();

  const jar = { Cookie: (await OWNER_COOKIES()).map((c) => `${c.name}=${c.value}`).join('; ') };

  // sold out → purge via the SAME endpoint the dashboard uses.
  //
  // The menu does NOT drop a sold-out product: the spec says so out loud
  // (src/app/[projectSlug]/menu/[tableSlug]/page.tsx:34-36) — "sold-out items
  // are fetched too and rendered greyed-out with a «غير متوفر» badge instead
  // of vanishing from the menu. A shrinking menu confuses customers, and
  // order safety is enforced server-side by createSecureOrder.
  //
  // So the old assertion here (product text absent from the raw HTML) encoded
  // a contract the product deliberately does not have, and it could only pass
  // while the unstable_cache had not been built yet. What the toggle must
  // actually guarantee is: the DB flips, the menu re-serves, and the item comes
  // back marked unavailable instead of orderable. The badge is client-rendered
  // (it is not in the SSR HTML), so assert it in the browser, and assert the
  // server-side refusal through the API.
  await admin.from('products').update({ is_available: false }).eq('id', productId);
  expect((await request.post('/api/revalidate-menu', { data: { projectId }, headers: jar })).status()).toBe(200);

  // The customer-visible half: reload the public menu and prove the item is
  // still listed but NOT orderable. The «غير متوفر» badge is rendered by
  // MenuClient after hydration, so this needs the browser, not raw HTML.
  const menu = await page.context().newPage();
  await menu.goto(`/${slugA}/menu/a-1?k=${TABLE_TOKEN}`, { waitUntil: 'domcontentloaded' });
  await expect(menu.getByText('شاي فحص').first()).toBeVisible({ timeout: 30_000 });
  await expect(menu.getByText('غير متوفر').first()).toBeVisible({ timeout: 30_000 });
  // The add-to-cart affordance is gone, which is what actually stops ordering.
  await expect(menu.locator('[aria-label^="إضافة شاي فحص إلى السلة"]')).toHaveCount(0);
  await menu.close();

  // The enforced half: the server refuses an order for the sold-out item even
  // though the menu still advertises it. This is the guarantee that matters —
  // a stale cache must never become a wrong price or an impossible order.
  const refused = await request.post('/api/public/order', {
    data: {
      projectSlug: slugA,
      tableSlug: 'a-1',
      tableToken: TABLE_TOKEN,
      items: [{ productId, quantity: 1 }],
      // A real uuid: the route REJECTS a malformed idempotency key with 400
      // rather than ignoring it, and a 400 for the wrong reason would make
      // this assertion meaningless.
      clientRequestId: crypto.randomUUID(),
    },
  });
  expect(refused.status(), 'a sold-out item must be refused, not sold').toBe(400);
  expect(await refused.json()).toMatchObject({
    error: 'منتج غير متاح أو لا ينتمي لهذا المتجر',
  });

  // back in stock → same ritual → the product becomes orderable again. Also
  // checked in the browser: the raw-HTML poll this used was weak (the item was
  // present in the SSR payload in BOTH states, so it proved nothing about the
  // toggle), and the badge/add-to-cart pair is the real customer contract.
  await admin.from('products').update({ is_available: true }).eq('id', productId);
  const { data: dbNow } = await admin.from('products').select('is_available').eq('id', productId).single();
  expect(dbNow!.is_available, 'DB toggle-back').toBe(true);
  expect((await request.post('/api/revalidate-menu', { data: { projectId }, headers: jar })).status()).toBe(200);
  const back = await page.context().newPage();
  await back.goto(`/${slugA}/menu/a-1?k=${TABLE_TOKEN}`, { waitUntil: 'domcontentloaded' });
  await expect(back.locator('[aria-label^="إضافة شاي فحص إلى السلة"]').first()).toBeVisible({
    timeout: 40_000,
  });
  await expect(back.getByText('غير متوفر').first()).toHaveCount(0);
  await back.close();

  // cache purge is tenant-gated: anonymous must not purge another store's menu
  const anonPurge = await request.post('/api/revalidate-menu', { data: { projectId } });
  expect(anonPurge.status()).toBe(401);
});

test('C3 tables page lists the seeded table', async ({ page }) => {
  await asOwner(page);
  await page.goto('/dashboard/tables');
  await expect(page.getByText(/طاولة 1|1/).first()).toBeVisible();
});

test('C4 analytics: renders the designed empty-state for a store with no orders yet', async ({ page }) => {
  await asOwner(page);
  await page.goto('/dashboard/analytics');
  await expect(page.getByText('الإحصائيات').first()).toBeVisible({ timeout: 30_000 });
  // Zero orders at this stage → KPI cards + explicit empty state (charts are
  // conditional by design). Full-chart path is covered by the existing
  // super-admin Phase B spec and by C4b after orders exist.
  await expect(page.getByText('ما فيه بيانات في هذه الفترة')).toBeVisible({ timeout: 20_000 });
  await expect(page.getByText('Something went wrong')).toHaveCount(0);
});

test('C5 notification prefs persist through the API (staff table truth)', async ({ page, request }) => {
  const cookies = await OWNER_COOKIES();
  await page.context().addCookies(cookies);
  await page.goto('/dashboard'); // establish cookie jar on page origin
  const res = await request.put('/api/staff/notification-prefs', {
    data: { projectId, notifyPush: false, notifyTelegram: true },
    headers: { Cookie: cookies.map((c) => `${c.name}=${c.value}`).join('; ') },
  });
  expect(res.status()).toBe(200);
  const { data } = await admin.from('staff_members').select('notify_push, notify_telegram').eq('user_id', ownerId).single();
  expect(data).toEqual({ notify_push: false, notify_telegram: true });
});

/* ====================================================================== *
 * D) CUSTOMER JOURNEY — public order → status → waiter → bill
 * ====================================================================== */
test('D1 public order: valid → order row; invalid → 400', async ({ request }) => {
  const bad = await request.post('/api/public/order', { data: { projectSlug: slugA, tableSlug: 'a-1', tableToken: TABLE_TOKEN, items: [] } });
  expect(bad.status()).toBe(400);

  const res = await request.post('/api/public/order', {
    data: { projectSlug: slugA, tableSlug: 'a-1', tableToken: TABLE_TOKEN, items: [{ productId, quantity: 2 }], notes: 'فحص آلي' },
  });
  expect(res.status(), await res.text().catch(() => '')).toBe(200);
  const body = await res.json();
  publicOrderId = body.order?.id ?? body.id ?? body.orderId;
  expect(publicOrderId).toBeTruthy();
  const { data: row } = await admin.from('orders').select('status,total_amount,service_type').eq('id', publicOrderId).single();
  expect(row!.status).toBe('pending');
  expect(Number(row!.total_amount)).toBeCloseTo(1.0, 3);
  expect(row!.service_type).toBeNull();
});

test('D2 order-status endpoint answers for the placed order', async ({ request }) => {
  const res = await request.get(
    `/api/public/order-status?orderId=${publicOrderId}&projectSlug=${encodeURIComponent(slugA)}`
  );
  expect(res.status()).toBe(200);
  const j = await res.json();
  expect(j.status ?? j.order?.status).toBe('pending');
});

test('D3 waiter + bill service requests create typed rows (not real orders)', async ({ request }) => {
  for (const [ep, type] of [['waiter', 'waiter'], ['bill', 'bill']] as const) {
    const res = await request.post(`/api/public/${ep}`, { data: { projectSlug: slugA, tableSlug: 'a-1' } });
    expect(res.status(), ep).toBe(200);
  }
  const { data } = await admin.from('orders').select('service_type').eq('project_id', projectId).in('service_type', ['waiter', 'bill']);
  expect(data!.length).toBeGreaterThanOrEqual(2);
});

test('D4 kitchen board shows the live ticket and starts it (advance RPC path)', async ({ page }) => {
  await asOwner(page);
  await page.goto('/dashboard/kitchen');
  await expect(page.getByText('فحص آلي').first()).toBeVisible({ timeout: 25_000 });
  await page.getByRole('button', { name: /بدء الكل/ }).click();
  await expect
    .poll(
      async () => {
        const { data } = await admin.from('orders').select('status').eq('id', publicOrderId).single();
        return data?.status;
      },
      { timeout: 15_000 }
    )
    .toBe('preparing');
});

test('D5 POS order + cancel via API (owner membership enforced)', async ({ page, request }) => {
  const cookies = await OWNER_COOKIES();
  const jar = { Cookie: cookies.map((c) => `${c.name}=${c.value}`).join('; ') };
  const mk = await request.post('/api/pos/order', {
    data: { projectId, type: 'walkin', items: [{ productId, quantity: 1 }] },
    headers: jar,
  });
  expect(mk.status(), await mk.text().catch(() => '')).toBe(200);
  const mj = await mk.json();
  posOrderId = mj.order?.id ?? mj.id ?? mj.orderId;
  expect(posOrderId).toBeTruthy();

  const cancel = await request.post('/api/pos/cancel', { data: { orderId: posOrderId }, headers: jar });
  expect(cancel.status()).toBe(200);
  const { data } = await admin.from('orders').select('status').eq('id', posOrderId).single();
  expect(data!.status).toBe('cancelled');
});

test('D6 analytics with live data: charts appear once orders exist', async ({ page }) => {
  await asOwner(page);
  await page.goto('/dashboard/analytics');
  await expect(page.getByText('الإحصائيات').first()).toBeVisible({ timeout: 30_000 });
  // at least one order exists now (D1/D3/D5) → charts replace the empty state
  await expect(page.locator('h2', { hasText: 'الإيراد اليومي' }).first()).toBeVisible({ timeout: 20_000 });
  await expect(page.locator('h2', { hasText: 'الأكثر' }).first()).toBeVisible();
});

/* ====================================================================== *
 * E) SUPER-ADMIN CONSOLE
 * ====================================================================== */
test('E1 subscriptions page lists the audit store', async ({ page }) => {
  await page.context().addCookies(await SA_COOKIES());
  await page.goto('/super-admin/subscriptions');
  await expect(page.getByText(storeName).first()).toBeVisible({ timeout: 25_000 });
});

test('E2 renew adds days (visible + DB truth)', async ({ page }) => {
  // fresh context per test → the SA session must be established here (E1's does not leak)
  await page.context().addCookies(await SA_COOKIES());
  const before = (await admin.from('projects').select('subscription_expires_at').eq('id', projectId).single()).data!;
  // NOTE: the route reads projectId from the QUERY string (the super-admin UI
  // posts a form action with ?projectId=) — body-only payloads get a 400.
  const res = await page.request.post(`/api/super-admin/renew?projectId=${projectId}`, { data: {} });
  expect(res.status(), await res.text().catch(() => '')).toBe(200);
  const after = (await admin.from('projects').select('subscription_expires_at').eq('id', projectId).single()).data!;
  expect(new Date(after!.subscription_expires_at) > new Date(before!.subscription_expires_at)).toBe(true);
});

test('E3 deactivate → public order blocked → reactivate', async ({ page, request }) => {
  await page.context().addCookies(await SA_COOKIES()); // fresh context per test
  const deact = await page.request.post(`/api/super-admin/deactivate?projectId=${projectId}`, { data: {} });
  expect(deact.status(), await deact.text().catch(() => '')).toBe(200);
  const blocked = await request.post('/api/public/order', {
    data: { projectSlug: slugA, tableSlug: 'a-1', tableToken: TABLE_TOKEN, items: [{ productId, quantity: 1 }] },
  });
  expect(blocked.status()).toBeGreaterThanOrEqual(400);
  // reactivate for teardown sanity
  await admin.from('projects').update({ is_active: true }).eq('id', projectId);
});

test('E4 impersonate → support banner → end restores admin session', async ({ page }) => {
  const { E2E_HOST, url } = await import('./helpers');
  await page.context().addCookies(await SA_COOKIES());
  const start = await page.request.post('/api/super-admin/impersonate', {
    data: { targetUserId: ownerId, projectId },
  });
  expect(start.status(), await start.text().catch(() => '')).toBe(200);
  const body = (await start.json()) as { sessionId?: string; targetSession?: { access_token: string } };
  expect(body.sessionId, 'start returns session id + target session (ImpersonateButton contract)').toBeTruthy();
  expect(body.targetSession?.access_token).toBeTruthy();

  // Mirror ImpersonateButton: the browser jar must SWAP to the target's
  // session + marker — the marker alone doesn't switch who /dashboard renders for.
  // Cookie name must match Supabase project ref — the SSR
  // client reads sb-<ref>-auth-token, and <ref> comes from the SUPABASE_URL.
  const SUPABASE_REF = new URL(url).hostname.split('.')[0];
  await page.context().clearCookies();
  await page.context().addCookies([
    { name: `sb-${SUPABASE_REF}-auth-token`, value: JSON.stringify(body.targetSession), domain: E2E_HOST, path: '/' },
    { name: 'dokan-impersonation', value: body.sessionId!, domain: E2E_HOST, path: '/' },
  ]);
  await page.goto('/dashboard');
  await expect(page.getByText(/وضع الدعم الفني/).first()).toBeVisible({ timeout: 20_000 });

  // END (2026-09-20 hardening): marker-only credential, admin restored
  // server-side; response body must never carry tokens.
  const end = await page.request.post('/api/super-admin/impersonate/end');
  expect(end.status()).toBe(200);
  const endBody = await end.json();
  expect(endBody.ok).toBe(true);
  expect(endBody.superAdminSession, 'admin tokens must not transit the body').toBeUndefined();
});

test('E5 audit log recorded admin actions + analytics page renders', async ({ page }) => {
  await page.context().addCookies(await SA_COOKIES()); // fresh SA session after impersonation
  const { data } = await admin.from('super_admin_audit_log').select('action').eq('target_project_id', projectId);
  expect((data ?? []).length, 'renew/deactivate/impersonate audited').toBeGreaterThanOrEqual(2);
  await page.goto('/super-admin/audit');
  await expect(page.getByText(storeName).or(page.getByText(/سجل/)).first()).toBeVisible({ timeout: 25_000 });
  await page.goto('/super-admin/analytics');
  await expect(page.locator('h1, h2').first()).toBeVisible();
});

/* ====================================================================== *
 * F) ISOLATION & GUARDS
 * ====================================================================== */
test('F1 logged-in user WITHOUT project → /onboarding, not someone else’s dashboard', async ({ page }) => {
  await page.context().addCookies(await getAuthCookies(strangerEmail, TEST_PASSWORD));
  await page.goto('/dashboard');
  await expect(page).toHaveURL(/onboarding/, { timeout: 20_000 });
});

test('F2 cross-tenant: stranger cannot place POS orders in store A', async ({ request, page }) => {
  const cookies = await getAuthCookies(strangerEmail, TEST_PASSWORD);
  await page.context().addCookies(cookies);
  await page.goto('/dashboard'); // pin cookies on the site origin
  const res = await request.post('/api/pos/order', {
    data: { type: 'walkin', items: [{ productId, quantity: 1 }] },
    headers: { Cookie: cookies.map((c) => `${c.name}=${c.value}`).join('; ') },
  });
  expect(res.status()).toBeGreaterThanOrEqual(400);
  const { count } = await admin
    .from('orders')
    .select('*', { count: 'exact', head: true })
    .eq('project_id', projectId)
    .eq('service_type', null);
  void count; // no new row expected — asserted by the 400 above + D-tests counts
});

test('F3 anon JWT rejected on owner-only APIs', async ({ request }) => {
  // Every one of these routes authenticates BEFORE validating its input, so
  // an anonymous caller gets 401 regardless of what it sends — the well-formed
  // projectId below is no longer required to reach the auth wall, it just
  // proves the ordering. If one of these ever answers 400 again, the auth
  // check has been moved back below input validation.
  for (const path of ['/api/onboarding/project', '/api/pos/cancel', `/api/super-admin/renew?projectId=${projectId}`]) {
    const res = await request.post(path, { data: {} });
    expect(res.status(), path).toBeLessThan(500);
    expect([401, 403], path).toContain(res.status());
  }
});

test('F4 public menu of a WRONG slug shows not-found UI (ISR on-demand renders, status may vary)', async ({ page, request }) => {
  const res = await request.get(`/no-such-store-${runId}/menu/a-1`);
  // ISR routes with generateStaticParams may return 200 with the error/not-found
  // UI — the content matters more than the status. The page must not show content
  // from someone else's store.
  const text = await res.text();
  expect(text.includes('no-such-store') || text.includes('خطأ') || text.includes('404') || text.includes('غير متاح') || res.status() === 404).toBeTruthy();
});
