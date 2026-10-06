import { test, expect, type BrowserContext } from '@playwright/test';
import {
  admin,
  cleanupTestUser,
  createTestUser,
  getAuthCookies,
  makeEmail,
  TEST_PASSWORD,
} from './helpers';

/**
 * MERCHANT / OWNER LIFECYCLE — the whole owner journey driven THROUGH THE REAL
 * UI in one serial run, end to end:
 *
 *   1) signup on /register (no API shortcut)  → lands on /onboarding
 *   2) the 3-step onboarding wizard, typed field by field → /dashboard
 *   3) /dashboard/settings — rename the store (UI + DB truth)
 *   4) /dashboard/products — category, 2 products (one with an addon),
 *      availability toggle, price edit, delete (DB-verified at every step)
 *   5) /dashboard/tables — 2 tables + a real generated QR image
 *   6) /dashboard/orders — empty state
 *   7) /dashboard/analytics — empty state
 *   8) logout from the sidebar → back on /login, /dashboard unreachable
 *
 * Every Arabic string + selector below was grepped out of the real components
 * (see the header comment per test for the file it came from); nothing here is
 * invented. Everything it creates is destroyed in afterAll.
 */
test.describe.configure({ mode: 'serial' });

const email = makeEmail();
const runId = Date.now() % 1_000_000;

const storeName = `متجر التاجر ${runId}`;
const renamedStore = `متجر التاجر المعدّل ${runId}`;
const slug = `e2e-life-${runId}`;
const categoryName = `مشروبات ${runId}`;
const plainProduct = `قهوة اليوم ${runId}`;
const addonProduct = `موهيتو الليمون ${runId}`;
const addonName = `نعناع طازج ${runId}`;

let projectId = '';
/** Session cookies captured from the REAL /register signup (see step 1) so
 *  every later test replays the UI-created session instead of minting one. */
let sessionCookies: { name: string; value: string; domain: string; path: string }[] = [];

test.afterAll(async () => {
  await cleanupTestUser(email);
});

/** Replay the session produced by the real signup form. Falls back to the
 *  helpers' API path ONLY if the UI run produced no cookies at all (never the
 *  case when step 1 passed — that test asserts the UI flow end to end). */
async function ensureSession(context: BrowserContext): Promise<void> {
  if (sessionCookies.length) {
    await context.addCookies(sessionCookies);
    return;
  }
  try {
    sessionCookies = await getAuthCookies(email, TEST_PASSWORD);
  } catch {
    await createTestUser(email);
    sessionCookies = await getAuthCookies(email, TEST_PASSWORD);
  }
  await context.addCookies(sessionCookies);
}

/* ------------------------------------------------------------------ *
 * 1) SIGNUP THROUGH THE REAL UI                                        *
 * src/app/register/page.tsx — h1 «إنشاء حساب», #fullName / #email /     *
 * #password, submit «إنشاء الحساب», then router.push('/onboarding')     *
 * ------------------------------------------------------------------ */
test('1) signup via the real /register form → /onboarding', async ({ page, context }) => {
  await page.goto('/register');
  await expect(page.getByRole('heading', { name: 'إنشاء حساب' })).toBeVisible({ timeout: 25_000 });

  await page.locator('#fullName').fill('تاجر الاختبار');
  await page.locator('#email').fill(email);
  await page.locator('#password').fill(TEST_PASSWORD);
  await page.getByRole('button', { name: 'إنشاء الحساب' }).click();

  await page.waitForURL('**/onboarding', { timeout: 30_000 });
  // The wizard is the landing page — and /onboarding only renders it for a
  // signed-in user with NO project yet (page.tsx redirects to /dashboard
  // otherwise), so reaching it proves signup + auto sign-in really happened.
  await expect(page.getByText('الخطوة 1 من 3')).toBeVisible({ timeout: 25_000 });

  // The account really exists and is email-confirmed (password sign-in works).
  const probe = await getAuthCookies(email, TEST_PASSWORD);
  expect(probe.length, 'UI form created a usable auth account').toBeGreaterThan(0);

  // Keep the exact browser session the real form produced for the next steps.
  const captured = await context.cookies();
  sessionCookies = captured
    .filter((c) => c.name.startsWith('sb-') && c.name.includes('auth-token'))
    .map((c) => ({ name: c.name, value: c.value, domain: c.domain, path: c.path }));
  expect(
    sessionCookies.length,
    'supabase session cookie captured from the UI signup'
  ).toBeGreaterThan(0);
});

/* ------------------------------------------------------------------ *
 * 2) ONBOARDING — 3 steps, all typed by hand                          *
 * src/app/onboarding/page.tsx — «الخطوة N من 3», #name,               *
 * «التالي» ×2, #slug-step2, «أنشئ متجرك الآن»                        *
 * src/app/dashboard/page.tsx — h1 «مرحبًا، {name} ☕»                  *
 * ------------------------------------------------------------------ */
test('2) onboarding wizard (3 steps) → /dashboard greets the store by name', async ({ page, context }) => {
  await ensureSession(context);
  await page.goto('/onboarding');

  // --- step 1: store name ---
  await expect(page.getByText('الخطوة 1 من 3')).toBeVisible({ timeout: 25_000 });
  await expect(page.getByRole('heading', { name: 'اسم المتجر' })).toBeVisible();
  await page.locator('#name').fill(storeName);
  await page.getByRole('button', { name: 'التالي', exact: true }).click();

  // --- step 2: slug + currency ---
  await expect(page.getByText('الخطوة 2 من 3')).toBeVisible({ timeout: 20_000 });
  await expect(page.getByRole('heading', { name: 'الرابط والعملة' })).toBeVisible();
  await page.locator('#slug-step2').fill(slug);
  await expect(page.locator('#slug-step2')).toHaveValue(slug);
  await page.getByRole('button', { name: 'التالي', exact: true }).click();

  // --- step 3: review + create ---
  await expect(page.getByText('الخطوة 3 من 3')).toBeVisible({ timeout: 20_000 });
  await expect(page.getByRole('heading', { name: 'تأكيد المتجر' })).toBeVisible();
  await page.getByRole('button', { name: 'أنشئ متجرك الآن', exact: true }).click();

  await page.waitForURL('**/dashboard', { timeout: 30_000 });
  await expect(page.getByRole('heading', { level: 1 })).toContainText(storeName, { timeout: 25_000 });

  // DB truth: the wizard created project + owner membership with our slug.
  projectId = (await findProject()) ?? '';
  expect(projectId, 'onboarding created a project').toBeTruthy();
  const { data: proj } = await admin
    .from('projects')
    .select('name, slug')
    .eq('id', projectId)
    .single();
  expect(proj?.name).toBe(storeName);
  expect(proj?.slug).toBe(slug);

  const { data: staff } = await admin
    .from('staff_members')
    .select('role')
    .eq('project_id', projectId);
  expect(staff?.[0]?.role).toBe('owner');
});

/* ------------------------------------------------------------------ *
 * 3) STORE SETTINGS                                                    *
 * src/app/dashboard/settings/settings-client.tsx — h1 «الإعدادات»,    *
 * #store-name, submit «حفظ التغييرات», toast «تم الحفظ»              *
 * ------------------------------------------------------------------ */
test('3) settings: rename the store → UI + DB', async ({ page, context }) => {
  await ensureSession(context);
  await page.goto('/dashboard/settings');
  await expect(page.getByRole('heading', { name: 'الإعدادات' })).toBeVisible({ timeout: 25_000 });

  await expect(page.locator('#store-name')).toHaveValue(storeName, { timeout: 20_000 });
  await page.locator('#store-name').fill(renamedStore);
  await page.getByRole('button', { name: 'حفظ التغييرات', exact: true }).click();
  await expect(page.getByText('تم الحفظ').first()).toBeVisible({ timeout: 20_000 });

  // DB-first verification of the rename.
  await expect
    .poll(async () => (await admin.from('projects').select('name').eq('id', projectId).single()).data?.name, {
      timeout: 20_000,
    })
    .toBe(renamedStore);

  // Persisted across a full reload (not just optimistic client state).
  await page.reload();
  await expect(page.locator('#store-name')).toHaveValue(renamedStore, { timeout: 25_000 });
  // Slug stays read-only after the onboarding wizard set it.
  await expect(page.locator('#store-slug')).toBeDisabled();
  await expect(page.locator('#store-slug')).toHaveValue(slug);
});

/* ------------------------------------------------------------------ *
 * 4) CATEGORIES + PRODUCTS                                             *
 * src/app/dashboard/products/products-client.tsx — «تصنيف جديد»,       *
 *   «منتج جديد», «ما فيه منتجات حالياً» (empty state)                 *
 * src/components/dashboard/products/category-manager.tsx — dialog       *
 *   «تصنيف جديد», placeholder «مثال: مشروبات ساخنة», submit «إنشاء»   *
 * src/components/dashboard/products/product-form-modal.tsx — dialogs   *
 *   «منتج جديد»/«تعديل منتج», placeholders «مثال: قهوة عربية»/         *
 *   «اسم الإضافة», #product-price, switch «المنتج متاح للطلب»,        *
 *   «إضافة المنتج»/«حفظ التغييرات», delete «حذف»                       *
 * src/components/dashboard/products/product-card.tsx — card aria-label  *
 *   «تعديل {name}», «متوقف» badge                                     *
 * src/app/dashboard/products/products-client.tsx — confirm dialog       *
 *   «حذف المنتج» → «نعم، احذف»                                        *
 * ------------------------------------------------------------------ */
test('4) products UI: category → 2 products (one with addon) → toggle → edit price → delete', async ({ page, context }) => {
  await ensureSession(context);
  await page.goto('/dashboard/products');
  await expect(page.getByRole('heading', { name: 'المنتجات' })).toBeVisible({ timeout: 25_000 });
  // Brand-new store: the products empty state is the starting point.
  await expect(page.getByText('ما فيه منتجات حالياً')).toBeVisible({ timeout: 20_000 });

  // ---- 4a. category ----
  await page.getByRole('button', { name: 'تصنيف جديد', exact: true }).click();
  const catDialog = page.getByRole('dialog', { name: 'تصنيف جديد' });
  await expect(catDialog).toBeVisible({ timeout: 20_000 });
  await catDialog.getByPlaceholder('مثال: مشروبات ساخنة').fill(categoryName);
  await catDialog.getByRole('button', { name: 'إنشاء', exact: true }).click();
  await expect(catDialog).toBeHidden({ timeout: 20_000 });

  const { data: cat } = await admin
    .from('categories')
    .select('id, name')
    .eq('project_id', projectId)
    .eq('name', categoryName)
    .maybeSingle();
  expect(cat, 'category persisted').toBeTruthy();
  // Category chip rendered in the filter bar (chip name starts with the name).
  await expect(page.getByRole('button', { name: new RegExp(`^${categoryName}`) })).toBeVisible({ timeout: 20_000 });

  // ---- 4b. plain product ----
  await page.getByRole('button', { name: 'منتج جديد', exact: true }).first().click();
  const createDialog = page.getByRole('dialog', { name: 'منتج جديد' });
  await expect(createDialog).toBeVisible({ timeout: 20_000 });
  await createDialog.getByPlaceholder('مثال: قهوة عربية').fill(plainProduct);
  await createDialog.locator('#product-price').fill('0.750');
  // Category defaults to the first one — the one we just created.
  await createDialog.getByRole('button', { name: 'إضافة المنتج', exact: true }).click();
  await expect(createDialog).toBeHidden({ timeout: 20_000 });

  const plainId = await productIdByName(plainProduct);
  expect(plainId, 'plain product persisted').toBeTruthy();
  const { data: plain } = await admin
    .from('products')
    .select('name, price, is_available, category_id')
    .eq('id', plainId!)
    .single();
  expect(plain?.name).toBe(plainProduct);
  expect(Number(plain?.price)).toBeCloseTo(0.75, 3);
  expect(plain?.is_available).toBe(true);
  expect(plain?.category_id).toBe(cat!.id);
  await expect(page.getByLabel(`تعديل ${plainProduct}`)).toBeVisible({ timeout: 20_000 });

  // ---- 4c. product with options ----
  await page.getByRole('button', { name: 'منتج جديد', exact: true }).click();
  const addonDialog = page.getByRole('dialog', { name: 'منتج جديد' });
  await expect(addonDialog).toBeVisible({ timeout: 20_000 });
  await addonDialog.getByPlaceholder('مثال: قهوة عربية').fill(addonProduct);
  await addonDialog.getByPlaceholder('وصف مختصر للمنتج يظهر للعملاء في القائمة').fill('مشروب منعش بارد');
  await addonDialog.locator('#product-price').fill('1.250');
  // Options block: «خيار جديد» → group name + one variety with its price.
  await addonDialog.getByRole('button', { name: 'خيار جديد' }).click();
  await addonDialog.getByPlaceholder('اسم الخيار (مثال: الحجم)').fill('النوع');
  await addonDialog.getByPlaceholder('اسم النوع (مثال: كبير)').fill(addonName);
  await addonDialog.getByPlaceholder('0.000').nth(1).fill('0.250');
  await addonDialog.getByRole('button', { name: 'إضافة المنتج', exact: true }).click();
  await expect(addonDialog).toBeHidden({ timeout: 20_000 });

  const addonProductId = await productIdByName(addonProduct);
  expect(addonProductId, 'option product persisted').toBeTruthy();
  const { data: withOptions } = await admin
    .from('products')
    .select('price, option_groups(name, option_choices(name, price))')
    .eq('id', addonProductId!)
    .single();
  expect(Number(withOptions?.price)).toBeCloseTo(1.25, 3);
  const optGroups = withOptions?.option_groups as unknown as {
    name: string;
    option_choices: { name: string; price: number }[];
  }[];
  expect(optGroups, 'one option group persisted').toHaveLength(1);
  expect(optGroups[0].name).toBe('النوع');
  expect(optGroups[0].option_choices).toHaveLength(1);
  expect(optGroups[0].option_choices[0].name).toBe(addonName);
  expect(Number(optGroups[0].option_choices[0].price)).toBeCloseTo(0.25, 3);
  await expect(page.getByLabel(`تعديل ${addonProduct}`)).toBeVisible({ timeout: 20_000 });

  // ---- 4d. toggle the plain product to unavailable ----
  await page.getByLabel(`تعديل ${plainProduct}`).click();
  const editPlain = page.getByRole('dialog', { name: 'تعديل منتج' });
  await expect(editPlain).toBeVisible({ timeout: 20_000 });
  await expect(editPlain.getByRole('switch', { name: 'المنتج متاح للطلب' })).toHaveAttribute('aria-checked', 'true');
  await editPlain.getByRole('switch', { name: 'المنتج متاح للطلب' }).click();
  await editPlain.getByRole('button', { name: 'حفظ التغييرات', exact: true }).click();
  await expect(editPlain).toBeHidden({ timeout: 20_000 });

  await expect
    .poll(async () => (await admin.from('products').select('is_available').eq('id', plainId!).single()).data?.is_available, {
      timeout: 20_000,
    })
    .toBe(false);
  // UI reflects it: the «متوقف» badge is on the card.
  await expect(page.getByLabel(`تعديل ${plainProduct}`).getByText('متوقف')).toBeVisible({ timeout: 20_000 });

  // ---- 4e. edit the addon product's price ----
  await page.getByLabel(`تعديل ${addonProduct}`).click();
  const editAddon = page.getByRole('dialog', { name: 'تعديل منتج' });
  await expect(editAddon).toBeVisible({ timeout: 20_000 });
  await editAddon.locator('#product-price').fill('2.500');
  await editAddon.getByRole('button', { name: 'حفظ التغييرات', exact: true }).click();
  await expect(editAddon).toBeHidden({ timeout: 20_000 });

  await expect
    .poll(async () => (await admin.from('products').select('price').eq('id', addonProductId!).single()).data?.price, {
      timeout: 20_000,
    })
    .toBeCloseTo(2.5, 3);

  // ---- 4f. delete the plain (stopped) product ----
  await page.getByLabel(`تعديل ${plainProduct}`).click();
  await expect(page.getByRole('dialog', { name: 'تعديل منتج' })).toBeVisible({ timeout: 20_000 });
  await page.getByRole('dialog', { name: 'تعديل منتج' }).getByRole('button', { name: 'حذف', exact: true }).click();
  const confirmDialog = page.getByRole('dialog', { name: 'حذف المنتج' });
  await expect(confirmDialog).toBeVisible({ timeout: 20_000 });
  await confirmDialog.getByRole('button', { name: 'نعم، احذف' }).click();
  await expect(confirmDialog).toBeHidden({ timeout: 20_000 });

  await expect
    .poll(async () => (await admin.from('products').select('id').eq('id', plainId!).maybeSingle()).data, {
      timeout: 20_000,
    })
    .toBeNull();
  await expect(page.getByLabel(`تعديل ${plainProduct}`)).toBeHidden({ timeout: 20_000 });
  // The other product survived the delete.
  await expect(page.getByLabel(`تعديل ${addonProduct}`)).toBeVisible({ timeout: 20_000 });
});

/* ------------------------------------------------------------------ *
 * 5) TABLES + QR                                                       *
 * src/app/dashboard/tables/tables-client.tsx — h1 «الطاولات و QR»,     *
 *   «طاولة جديدة» → dialog «طاولة جديدة» + «إنشاء + توليد QR»,         *
 *   QR dialog «QR — طاولة N» with <img alt="QR Code">, «عرض QR»        *
 * ------------------------------------------------------------------ */
test('5) tables UI: create 2 tables + assert a real QR image is generated', async ({ page, context }) => {
  await ensureSession(context);
  await page.goto('/dashboard/tables');
  await expect(page.getByRole('heading', { name: 'الطاولات و QR' })).toBeVisible({ timeout: 25_000 });
  await expect(page.getByText('ما فيه طاولات بعد')).toBeVisible({ timeout: 20_000 });

  // ---- table 1 (the create modal auto-opens the QR preview) ----
  await page.getByRole('button', { name: 'طاولة جديدة', exact: true }).click();
  const createTable = page.getByRole('dialog', { name: 'طاولة جديدة' });
  await expect(createTable).toBeVisible({ timeout: 20_000 });
  await createTable.locator('input[type="number"]').fill('1');
  await createTable.getByRole('button', { name: 'إنشاء + توليد QR', exact: true }).click();

  const qr1 = page.getByRole('dialog', { name: 'QR — طاولة 1' });
  await expect(qr1).toBeVisible({ timeout: 25_000 });
  // A real QR PNG data-URL (not a placeholder box) pointing at our menu.
  await expect(qr1.getByRole('img', { name: 'QR Code' })).toHaveAttribute('src', /^data:image\/png;base64,/, { timeout: 25_000 });
  await expect(qr1).toContainText(`/${slug}/menu/table-1`, { timeout: 20_000 });
  await expect(page.getByText('طاولة 1').first()).toBeVisible({ timeout: 20_000 });
  await qr1.getByRole('button', { name: 'إغلاق' }).click();
  await expect(qr1).toBeHidden({ timeout: 20_000 });

  // ---- table 2 (slugs derive from the number) ----
  await page.getByRole('button', { name: 'طاولة جديدة', exact: true }).click();
  await expect(createTable).toBeVisible({ timeout: 20_000 });
  await createTable.locator('input[type="number"]').fill('2');
  await createTable.getByRole('button', { name: 'إنشاء + توليد QR', exact: true }).click();
  const qr2 = page.getByRole('dialog', { name: 'QR — طاولة 2' });
  await expect(qr2).toBeVisible({ timeout: 25_000 });
  await qr2.getByRole('button', { name: 'إغلاق' }).click();

  // Both tables listed.
  await expect(page.getByText('طاولة 1').first()).toBeVisible({ timeout: 20_000 });
  await expect(page.getByText('طاولة 2').first()).toBeVisible({ timeout: 20_000 });
  await expect(page.getByText('table-1').first()).toBeVisible({ timeout: 20_000 });
  await expect(page.getByText('table-2').first()).toBeVisible({ timeout: 20_000 });

  // Re-open a QR from a table row itself (the per-table «عرض QR» control).
  const qrRow = page.locator('.dashboard-card').filter({ hasText: 'طاولة 2' }).first();
  await qrRow.getByRole('button', { name: 'عرض QR' }).click();
  const qrAgain = page.getByRole('dialog', { name: 'QR — طاولة 2' });
  await expect(qrAgain).toBeVisible({ timeout: 25_000 });
  await expect(qrAgain.getByRole('img', { name: 'QR Code' })).toHaveAttribute('src', /^data:image\/png;base64,/, { timeout: 25_000 });
  await qrAgain.getByRole('button', { name: 'إغلاق' }).click();
  await expect(qrAgain).toBeHidden({ timeout: 20_000 });

  // DB truth: both rows exist, active, with a QR token.
  const { data: tables } = await admin
    .from('tables')
    .select('number, slug, is_active, qrcode')
    .eq('project_id', projectId)
    .order('number');
  expect(tables).toHaveLength(2);
  expect(tables?.map((t) => t.number)).toEqual([1, 2]);
  expect(tables?.map((t) => t.slug)).toEqual(['table-1', 'table-2']);
  for (const t of tables ?? []) {
    expect(t.is_active).toBe(true);
    expect(t.qrcode, `QR token for table ${t.number}`).toBeTruthy();
  }
});

/* ------------------------------------------------------------------ *
 * 6) ORDERS BOARD — empty state                                        *
 * src/app/dashboard/orders/orders-client.tsx — h1 «الطلبات»,           *
 * EmptyState «ما فيه طلبات في هذا اليوم» / «أول طلب بيظهر هنا مباشرة.»*
 * ------------------------------------------------------------------ */
test('6) orders board: empty state renders when the store has no orders', async ({ page, context }) => {
  await ensureSession(context);
  const { count } = await admin
    .from('orders')
    .select('id', { count: 'exact', head: true })
    .eq('project_id', projectId);
  expect(count ?? 0, 'no orders in this store').toBe(0);

  await page.goto('/dashboard/orders');
  await expect(page.getByRole('heading', { name: 'الطلبات' })).toBeVisible({ timeout: 25_000 });
  await expect(page.getByRole('heading', { name: 'ما فيه طلبات في هذا اليوم' })).toBeVisible({ timeout: 20_000 });
  await expect(page.getByText('أول طلب بيظهر هنا مباشرة.')).toBeVisible({ timeout: 20_000 });
});

/* ------------------------------------------------------------------ *
 * 7) ANALYTICS — empty state                                           *
 * src/app/dashboard/analytics/analytics-client.tsx — h1 «الإحصائيات»,   *
 * «ما فيه بيانات في هذه الفترة»                                       *
 * ------------------------------------------------------------------ */
test('7) analytics: empty-state report renders with zero orders', async ({ page, context }) => {
  await ensureSession(context);
  await page.goto('/dashboard/analytics');
  await expect(page.getByRole('heading', { name: 'الإحصائيات' })).toBeVisible({ timeout: 25_000 });
  // KPI header still renders…
  await expect(page.getByText('الإيراد').first()).toBeVisible({ timeout: 20_000 });
  // …and the zero-orders body takes over from the charts.
  await expect(page.getByRole('heading', { name: 'ما فيه بيانات في هذه الفترة' })).toBeVisible({ timeout: 20_000 });
  await expect(page.getByText('أول طلب سيظهر هنا — جرّب فترات أطول أو افتح POS.')).toBeVisible({ timeout: 20_000 });
});

/* ------------------------------------------------------------------ *
 * 8) LOGOUT — session teardown                                         *
 * src/components/dashboard/app-sidebar.tsx — hamburger «فتح القائمة»,   *
 *   logout button «تسجيل الخروج» → router.push('/login')               *
 * src/app/login/page.tsx — h1 «تسجيل الدخول»                          *
 * src/proxy.ts — /dashboard is protected: guests get bounced to /login   *
 * ------------------------------------------------------------------ */
test('8) logout: sidebar control → /login, dashboard no longer reachable', async ({ page, context }) => {
  await ensureSession(context);
  await page.goto('/dashboard');
  await expect(page.getByRole('heading', { level: 1 })).toContainText(renamedStore, { timeout: 25_000 });

  // Mobile viewport (390px) → the sidebar lives behind the hamburger.
  const menuButton = page.getByRole('button', { name: 'فتح القائمة' });
  await expect(menuButton).toBeVisible({ timeout: 20_000 });
  await menuButton.click();

  const logout = page.getByRole('button', { name: 'تسجيل الخروج' });
  await expect(logout).toBeVisible({ timeout: 20_000 });
  await logout.click();

  await page.waitForURL('**/login**', { timeout: 30_000 });
  await expect(page.getByRole('heading', { name: 'تسجيل الدخول' })).toBeVisible({ timeout: 25_000 });

  // Protected route is gone: the proxy bounces the dead session to /login.
  await page.goto('/dashboard');
  await page.waitForURL('**/login**', { timeout: 25_000 });
  expect(page.url()).toContain('/login');
  await expect(page.getByRole('heading', { name: 'تسجيل الدخول' })).toBeVisible({ timeout: 20_000 });
});

/* ------------------------------------------------------------------ *
 * DB helpers                                                          *
 * ------------------------------------------------------------------ */

/** The onboarding wizard's project for this run (null before step 2 ran).
 *  Keyed on the run-unique slug the wizard typed in step 2 — deterministic,
 *  no paginated listUsers() scan. */
async function findProject(): Promise<string | null> {
  const { data } = await admin
    .from('projects')
    .select('id')
    .eq('slug', slug)
    .maybeSingle();
  return data?.id ?? null;
}

async function productIdByName(name: string): Promise<string | null> {
  const { data } = await admin
    .from('products')
    .select('id')
    .eq('project_id', projectId)
    .eq('name', name)
    .maybeSingle();
  return data?.id ?? null;
}
