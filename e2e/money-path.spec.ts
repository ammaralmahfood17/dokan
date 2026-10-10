import { test, expect, type Page } from '@playwright/test';
import { admin, findProjectId, createTestUser, cleanupTestUser, getAuthCookies, makeEmail, TEST_PASSWORD } from './helpers';

/**
 * THE MONEY PATH — full journey against production:
 * signup → onboarding (store) → product → table → QR menu order → orders
 * board → kitchen (start/done) → order ready. Everything is created inside
 * an isolated test store and removed in afterAll.
 */
test.describe.configure({ mode: 'serial' });

const email = makeEmail();
const runId = Date.now() % 1_000_000;
const storeName = `مقهى التجربة ${runId}`;
const slug = `e2e-${runId}`;

test.beforeAll(async () => {
  await createTestUser(email);
});

test.afterAll(async () => {
  await cleanupTestUser(email);
});

test('money path: signup → store → product → table → order → kitchen', async ({ page, context }) => {
  // ---------- 1) AUTH: inject session cookies (fresh user → /onboarding) ----------
  const authCookies = await getAuthCookies(email, TEST_PASSWORD);
  await context.addCookies(authCookies);
  await page.goto('/onboarding');
  await expect(page.getByText('اسم المتجر').first()).toBeVisible({ timeout: 25_000 });

  // ---------- 2) ONBOARDING: create store (3 steps) ----------
  await page.fill('#name', storeName);
  await page.getByRole('button', { name: 'التالي', exact: true }).click();
  await page.fill('#slug-step2', slug);
  await page.getByRole('button', { name: 'التالي', exact: true }).click();
  await page.getByRole('button', { name: 'أنشئ متجرك الآن', exact: true }).click();
  await page.waitForURL('**/dashboard', { timeout: 25_000 });
  await expect(page.getByRole('heading', { name: /مرحبًا، مقهى التجربة/ }).first()).toBeVisible();

  // ---------- 3) PRODUCTS: create one product ----------
  await page.goto('/dashboard/products');
  await page.getByRole('button', { name: 'منتج جديد', exact: true }).click();
  await page.fill('input[placeholder="مثال: قهوة عربية"]', 'قهوة عربية');
  await page.fill('input[placeholder="0.000"] >> nth=0', '0.500');
  await page.getByRole('button', { name: 'إضافة المنتج', exact: true }).click();
  await expect(page.getByText('قهوة عربية').first()).toBeVisible({ timeout: 15_000 });

  // ---------- 4) TABLES: create table 1 ----------
  await page.goto('/dashboard/tables');
  await page.getByRole('button', { name: 'طاولة جديدة', exact: true }).click();
  await page.locator('input[type="number"]').fill('1'); // slug auto-derives: table-1
  await page.getByRole('button', { name: 'إنشاء + توليد QR', exact: true }).click();
  // QR preview modal appears → close it
  await page.locator('[role="dialog"] button').last().click().catch(() => {});
  await expect(page.getByText('طاولة 1').first()).toBeVisible({ timeout: 15_000 });

  // ---------- 5) PUBLIC MENU: place a real order ----------
  // The table was created through the dashboard above, so read ITS scan token from the DB:
  // the public order route enforces it (REQUIRE_TABLE_TOKEN=true), and without `?k=` the cart's
  // confirm button reads «مسح الرمز» instead of «تأكيد الطلب».
  const seedProjectId = await findProjectId(email);
  const { data: seededTable } = await admin
    .from('tables')
    .select('qrcode')
    .eq('project_id', seedProjectId!)
    .single();
  const menu = await context.newPage();
  const menuUrl = `/${slug}/menu/table-1?k=${seededTable!.qrcode}`;
  const resp = await menu.goto(menuUrl);
  expect(resp?.status()).toBe(200);
  await expect(menu.getByText('قهوة عربية').first()).toBeVisible({ timeout: 20_000 });
  await menu.getByText('قهوة عربية').first().click();
  // Cart auto-opens on first add → confirm
  await expect(menu.getByRole('button', { name: 'تأكيد الطلب', exact: true })).toBeVisible();
  await menu.getByRole('button', { name: 'تأكيد الطلب', exact: true }).click();
  await expect(menu.getByText('تم استلام طلبك')).toBeVisible({ timeout: 20_000 });
  await menu.close();

  // ---------- 6) ORDERS BOARD: order arrived (grab its number from the card) ----------
  await page.goto('/dashboard/orders');
  const orderCard = page.locator('article').filter({ hasText: 'قهوة عربية' }).first();
  await expect(orderCard).toBeVisible({ timeout: 20_000 });
  const orderNumber = (await orderCard.textContent())?.match(/order-(\d+)/)?.[1];
  expect(orderNumber, 'order number should be on the card').toBeTruthy();
  console.log('✅ ORDER CREATED — order #', orderNumber);

  // ---------- 7) KITCHEN: start item → done → order ready ----------
  await page.goto('/dashboard/kitchen');
  await expect(page.getByRole('button', { name: 'بدء التحضير', exact: true }).first()).toBeVisible({ timeout: 20_000 });
  await page.getByRole('button', { name: 'بدء التحضير', exact: true }).first().click();
  await expect(page.getByRole('button', { name: 'جاهز للتسليم', exact: true }).first()).toBeVisible({ timeout: 15_000 });
  await page.getByRole('button', { name: 'جاهز للتسليم', exact: true }).first().click();
  // Item lands in ready column (v3 renders the button label as "تم التسليم ✓")
  await expect(page.getByRole('button', { name: 'تم التسليم' }).first()).toBeVisible({ timeout: 15_000 });

  // ---------- 8) ORDERS BOARD: order auto-advanced to ready ----------
  await page.goto('/dashboard/orders');
  const readyCard = page.locator('article').filter({ hasText: 'قهوة عربية' }).first();
  await expect(readyCard).toBeVisible({ timeout: 20_000 });
  await expect(readyCard.getByText('جاهز', { exact: true }).first()).toBeVisible({ timeout: 20_000 });

  console.log(`✅ MONEY PATH OK — order #${orderNumber} created, cooked, ready`);
});
