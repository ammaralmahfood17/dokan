import { test, expect } from '@playwright/test';
import { createTestUser, cleanupTestUser, getAuthCookies, makeEmail, TEST_PASSWORD, admin, url, anonKey, E2E_BASE_URL } from './helpers';

import { createClient, type SupabaseClient } from '@supabase/supabase-js';

/** Table scan token: public orders are gated on it since REQUIRE_TABLE_TOKEN=true. */
const TABLE_TOKEN = 'd1d1d1d1d1d1d1d1d1d1d1d1d1d1d1d1';
/** `tables.qrcode` is GLOBALLY unique (`tables_qrcode_key`), so the second project in
 *  the tenant-guard test needs its own token — reusing TABLE_TOKEN made the insert
 *  violate the index (the error was ignored) and the order then 404'd. */
const OTHER_TABLE_TOKEN = 'd2d2d2d2d2d2d2d2d2d2d2d2d2d2d2d2';
/** The throwaway second tenant (no created_by) — cleaned up explicitly in afterAll. */
let otherProjectId = '';

/**
 * P1-1 (H1/H2 regression guard) + P2-7 (ready→delivered gap).
 *
 * Tests the atomic order-status RPC (`advance_order_status`) directly — the
 * exact code path kitchen-client now calls — with a real authenticated user:
 *   1. Happy path: pending→preparing→ready→delivered moves order + items
 *      atomically (no stale items left pending).
 *   2. Race guard: cancel an order, then attempt to advance it from a stale
 *      screen (expected_status no longer matches) → STALE_STATUS rejection,
 *      order stays cancelled (H1: no revival).
 *   3. Cross-project attempt (F1): advancing an order of a project the user
 *      is NOT a member of → 42501 (tenant-membership guard).
 */
test.describe.configure({ mode: 'serial' });

const email = makeEmail();
const runId = Date.now() % 1_000_000;
const slug = `e2e-race-${runId}`;
let userId: string;
let projectId: string;
let tableId: string;
let productId: string;
let authed: SupabaseClient;

/** Create the test store + product + table via admin (setup, not under test). */
async function setupStore() {
  const { data: proj } = await admin
    .from('projects')
    .insert({ name: 'Race Test', slug, currency: 'BHD', primary_color: '#4338CA', is_active: true })
    .select('id')
    .single();
  if (!proj) throw new Error('project insert failed');
  projectId = proj.id;

  await admin.from('staff_members').insert({ project_id: projectId, user_id: userId, role: 'owner' });

  const { data: cat } = await admin
    .from('categories')
    .insert({ project_id: projectId, name: 'test', sort_order: 0 })
    .select('id')
    .single();
  const { data: prod } = await admin
    .from('products')
    .insert({ project_id: projectId, name: 'قهوة ريس', price: 0.5, category_id: cat!.id, is_available: true })
    .select('id')
    .single();
  productId = prod!.id;

  const { data: tbl } = await admin
    .from('tables')
    .insert({ project_id: projectId, number: 1, slug: 'table-1', is_active: true, qrcode: TABLE_TOKEN })
    .select('id')
    .single();
  tableId = tbl!.id;
}

/** Place a real order through the public API (exercises create_order_transactional). */
async function placeOrder(): Promise<{ orderId: string; orderNumber: number }> {
  const res = await fetch(`${url}/rest/v1/rpc/none`, { method: 'POST' }).catch(() => null);
  void res;
  const apiRes = await fetch(`${E2E_BASE_URL}/api/public/order`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({
      projectSlug: slug,
      tableSlug: 'table-1',
      tableToken: TABLE_TOKEN,
      items: [{ productId: productId, quantity: 1, notes: '' }],
    }),
  });
  const body = await apiRes.json();
  if (!apiRes.ok) throw new Error(`placeOrder failed ${apiRes.status}: ${JSON.stringify(body)}`);
  return { orderId: body.order?.id, orderNumber: body.order?.orderNumber };
}

test.beforeAll(async () => {
  const user = await createTestUser(email);
  userId = user.id;
  await setupStore();
  authed = createClient(url, anonKey(), {
    auth: { persistSession: false, autoRefreshToken: false },
  });
  const { error: se } = await authed.auth.signInWithPassword({ email, password: TEST_PASSWORD });
  if (se) throw new Error(`signIn failed: ${se.message}`);
});

test.afterAll(async () => {
  await cleanupTestUser(email);
  // The "other" tenant in the tenant-guard test has NO created_by, so cleanupTestUser cannot find
  // it — without this line the suite leaves an orphan project in production (found one:
  // e2e-other-943745). Everything under a project CASCADEs from `projects`, so one delete is enough.
  if (otherProjectId) await admin.from('projects').delete().eq('id', otherProjectId);
});

test('race guard: happy path advances order + items atomically to delivered', async () => {
  const { orderId } = await placeOrder();

  // pending → preparing
  const r1 = await authed.rpc('advance_order_status', {
    p_order_id: orderId,
    p_expected_status: 'pending',
    p_new_status: 'preparing',
    p_caller_user_id: userId,
  });
  expect(r1.error, `pending→preparing should succeed: ${r1.error?.message}`).toBeNull();

  // preparing → ready
  const r2 = await authed.rpc('advance_order_status', {
    p_order_id: orderId,
    p_expected_status: 'preparing',
    p_new_status: 'ready',
    p_caller_user_id: userId,
  });
  expect(r2.error, `preparing→ready should succeed: ${r2.error?.message}`).toBeNull();

  // ready → delivered
  const r3 = await authed.rpc('advance_order_status', {
    p_order_id: orderId,
    p_expected_status: 'ready',
    p_new_status: 'delivered',
    p_caller_user_id: userId,
  });
  expect(r3.error, `ready→delivered should succeed: ${r3.error?.message}`).toBeNull();

  // Atomicity: order delivered AND every item moved to 'ready' (the max
  // order_items CHECK allows) — no item left pending (H2 regression).
  const { data: order } = await admin
    .from('orders')
    .select('id, status, order_items(status)')
    .eq('id', orderId)
    .single();
  expect(order?.status).toBe('delivered');
  const itemStatuses = (order?.order_items as { status: string }[])?.map((i) => i.status) ?? [];
  expect(itemStatuses.length).toBeGreaterThan(0);
  expect(itemStatuses.every((s) => s === 'ready'), `items should all be ready, got ${itemStatuses.join(',')}`).toBe(true);
});

test('race guard: cancelled order cannot be revived via stale advance (H1)', async () => {
  const { orderId } = await placeOrder();

  // Cancel via the server-side cancel API (real path) — needs the session
  // cookie the browser would hold.
  const { data: sess } = await authed.auth.getSession();
  const ref = new URL(url).hostname.split('.')[0];
  const cancelRes = await fetch(`${E2E_BASE_URL}/api/pos/cancel`, {
    method: 'POST',
    headers: {
      'Content-Type': 'application/json',
      Cookie: `sb-${ref}-auth-token=${JSON.stringify(sess.session)}`,
    },
    body: JSON.stringify({ orderId }),
  });
  expect(cancelRes.status).toBe(200);

  // Stale screen tries to advance pending→preparing — must be rejected with
  // the distinguishable STALE_STATUS error, order stays cancelled.
  const r = await authed.rpc('advance_order_status', {
    p_order_id: orderId,
    p_expected_status: 'pending',
    p_new_status: 'preparing',
    p_caller_user_id: userId,
  });
  expect(r.error, 'stale advance must fail').not.toBeNull();
  expect(String(r.error?.message)).toContain('STALE_STATUS');

  const { data: order } = await admin.from('orders').select('status').eq('id', orderId).single();
  expect(order?.status).toBe('cancelled');
});

test('tenant guard (F1): advancing another project’s order is rejected 42501', async () => {
  // Second project the user is NOT a member of.
  const { data: otherProj } = await admin
    .from('projects')
    .insert({ name: 'Other', slug: `e2e-other-${runId}`, currency: 'BHD', primary_color: '#4338CA', is_active: true })
    .select('id')
    .single();
  otherProjectId = otherProj!.id;
  const { data: otherCat } = await admin
    .from('categories')
    .insert({ project_id: otherProj!.id, name: 't', sort_order: 0 })
    .select('id')
    .single();
  const { data: otherProd } = await admin
    .from('products')
    .insert({ project_id: otherProj!.id, name: 'ممنوع', price: 1, category_id: otherCat!.id, is_available: true })
    .select('id')
    .single();
  const { data: otherTbl } = await admin
    .from('tables')
    .insert({ project_id: otherProj!.id, number: 1, slug: 'table-1', is_active: true, qrcode: OTHER_TABLE_TOKEN })
    .select('id')
    .single();

  // Place an order in the OTHER project (admin can, as service_role).
  const apiRes = await fetch(`${E2E_BASE_URL}/api/public/order`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({
      projectSlug: `e2e-other-${runId}`,
      tableSlug: 'table-1',
      tableToken: OTHER_TABLE_TOKEN,
      items: [{ productId: otherProd!.id, quantity: 1, notes: '' }],
    }),
  });
  const placed = await apiRes.json();
  expect(apiRes.ok, `other-project order should place: ${JSON.stringify(placed)}`).toBe(true);
  const otherOrderId = placed.order_id ?? placed.order?.id;

  // User tries to advance the other project's order → membership guard rejects.
  const r = await authed.rpc('advance_order_status', {
    p_order_id: otherOrderId,
    p_expected_status: 'pending',
    p_new_status: 'preparing',
    p_caller_user_id: userId,
  });
  expect(r.error, 'cross-tenant advance must be rejected').not.toBeNull();
  expect(['42501', 'P0001']).toContain(r.error?.code);

  // Also verify the order was NOT touched.
  const { data: untouched } = await admin.from('orders').select('status').eq('id', otherOrderId).single();
  expect(untouched?.status).toBe('pending');

  // cleanup other project
  await admin.from('tables').delete().eq('id', otherTbl!.id);
  await admin.from('products').delete().eq('id', otherProd!.id);
  await admin.from('categories').delete().eq('id', otherCat!.id);
  const { data: otherOrders } = await admin.from('orders').select('id').eq('project_id', otherProj!.id);
  for (const o of otherOrders ?? []) await admin.from('order_items').delete().eq('order_id', o.id);
  await admin.from('orders').delete().eq('project_id', otherProj!.id);
  await admin.from('projects').delete().eq('id', otherProj!.id);
});
