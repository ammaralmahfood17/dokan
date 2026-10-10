import { test, expect } from '@playwright/test';
import { createTestUser, cleanupTestUser, getAuthCookies, makeEmail, TEST_PASSWORD, admin, url, anonKey, E2E_BASE_URL } from './helpers';

import { createClient, type SupabaseClient } from '@supabase/supabase-js';

/** Table scan token: public orders are gated on it since REQUIRE_TABLE_TOKEN=true. */
const TABLE_TOKEN = 'f1f1f1f1f1f1f1f1f1f1f1f1f1f1f1f1';

/**
 * P1-2 — subscription enforcement regression guard (Phase 2).
 *   1. A project with subscription_expires_at in the past is cut off:
 *      dashboard redirects to /subscription-expired, public ordering is blocked.
 *   2. expire_subscriptions() (the cron body, invoked directly — the task
 *      explicitly says don't wait for the real schedule) flips is_active=false.
 *   3. renew_subscription() (super admin only) restores access: dashboard
 *      loads again and public ordering works. Owner self-renewal is rejected
 *      (2026-08: subscribers no longer renew — the admin team controls it).
 */
test.describe.configure({ mode: 'serial' });

const email = makeEmail();
const runId = Date.now() % 1_000_000;
const slug = `e2e-sub-${runId}`;
let userId: string;
let projectId: string;
let productId: string;
let authed: SupabaseClient;

test.beforeAll(async () => {
  const user = await createTestUser(email);
  userId = user.id;

  const { data: proj } = await admin
    .from('projects')
    .insert({
      name: 'Sub Test',
      slug,
      currency: 'BHD',
      primary_color: '#4338CA',
      // EXPIRED by 1 hour.
      is_active: true,
      subscription_expires_at: new Date(Date.now() - 3600e3).toISOString(),
    })
    .select('id')
    .single();
  projectId = proj!.id;
  await admin.from('staff_members').insert({ project_id: projectId, user_id: userId, role: 'owner' });

  const { data: cat } = await admin
    .from('categories')
    .insert({ project_id: projectId, name: 'test', sort_order: 0 })
    .select('id')
    .single();
  const { data: prod } = await admin
    .from('products')
    .insert({ project_id: projectId, name: 'قهوة اشتراك', price: 1, category_id: cat!.id, is_available: true })
    .select('id')
    .single();
  productId = prod!.id;
  await admin
    .from('tables')
    .insert({ project_id: projectId, number: 1, slug: 'table-1', is_active: true, qrcode: TABLE_TOKEN });

  authed = createClient(url, anonKey(), { auth: { persistSession: false, autoRefreshToken: false } });
  const { error: se } = await authed.auth.signInWithPassword({ email, password: TEST_PASSWORD });
  if (se) throw new Error(`signIn failed: ${se.message}`);
});

test.afterAll(async () => {
  await cleanupTestUser(email);
});

test('expired subscription: dashboard blocked, public ordering blocked', async ({ page, context }) => {
  // Dashboard access → redirect to /subscription-expired (getCurrentProject guard).
  const authCookies = await getAuthCookies(email, TEST_PASSWORD);
  await context.addCookies(authCookies);
  await page.goto('/dashboard');
  await page.waitForURL('**/subscription-expired', { timeout: 25_000 });
  await expect(page.getByText('انتهى الاشتراك').first()).toBeVisible({ timeout: 15_000 });

  // Public ordering blocked: the project is still is_active=true but the
  // menu route resolves active projects; the guard is subscription-based at
  // the dashboard layer. Public ordering cut happens via is_active — flip it
  // the same way the cron would (expire_subscriptions, invoked directly).
  const { data: flipped, error: flipErr } = await admin.rpc('expire_subscriptions');
  expect(flipErr, `expire_subscriptions should run: ${flipErr?.message}`).toBeNull();
  const { data: afterFlip } = await admin.from('projects').select('is_active').eq('id', projectId).single();
  expect(afterFlip?.is_active).toBe(false);

  // Public order route must now reject the store.
  const orderRes = await fetch(`${E2E_BASE_URL}/api/public/order`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({
      projectSlug: slug,
      tableSlug: 'table-1',
      tableToken: TABLE_TOKEN,
      items: [{ productId: productId, quantity: 1, notes: '' }],
    }),
  });
  console.log('DEBUG order status after flip:', orderRes.status);
  expect(orderRes.status, 'public order must be blocked after expiry flip').toBe(404);

  // Public menu page: must NOT render the store's products. (Vercel serves
  // on-demand-static not-found with status 200 + not-found markup, so assert
  // on content: the product name must be absent.)
  const menuRes = await page.request.get(`/${slug}/menu/table-1`);
  const menuHtml = await menuRes.text();
  expect(menuHtml.includes('قهوة اشتراك'), 'deactivated store menu must not render its products').toBe(false);
});

test('renewal: owner self-renewal rejected, super admin renews and restores', async ({ page, context }) => {
  // Policy (2026-08): subscribers no longer self-renew — only the admin team
  // controls subscriptions/extensions. A direct RPC call as the owner must fail.
  const { error: ownerErr } = await authed.rpc('renew_subscription', {
    p_project_id: projectId,
    p_days: 30,
  });
  expect(ownerErr, 'owner direct renewal must be rejected').not.toBeNull();

  // Renew via the super-admin path (the same RPC /api/super-admin/renew calls).
  await admin.from('super_admins').insert({ user_id: userId });
  const { data: newExpiry, error: renewErr } = await admin.rpc('renew_subscription', {
    p_project_id: projectId,
    p_days: 30,
    p_caller_user_id: userId,
  });
  expect(renewErr, `renew should succeed for owner: ${renewErr?.message}`).toBeNull();
  expect(new Date(newExpiry as string).getTime()).toBeGreaterThan(Date.now());

  const { data: proj } = await admin.from('projects').select('is_active, subscription_expires_at').eq('id', projectId).single();
  expect(proj?.is_active).toBe(true);
  expect(new Date(proj?.subscription_expires_at as string).getTime()).toBeGreaterThan(Date.now());

  // Dashboard loads again (no redirect to expired).
  const authCookies = await getAuthCookies(email, TEST_PASSWORD);
  await context.addCookies(authCookies);
  await page.goto('/dashboard');
  await page.waitForURL('**/dashboard', { timeout: 25_000 });
  await expect(page.getByRole('heading', { name: /مرحبًا، Sub Test/ }).first()).toBeVisible({ timeout: 20_000 });

  // Public ordering works again.
  const orderRes = await fetch(`${E2E_BASE_URL}/api/public/order`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({
      projectSlug: slug,
      tableSlug: 'table-1',
      tableToken: TABLE_TOKEN,
      items: [{ productId: productId, quantity: 1, notes: '' }],
    }),
  });
  const placed = await orderRes.json();
  expect(orderRes.status, `order should work after renewal: ${JSON.stringify(placed)}`).toBe(200);
});
