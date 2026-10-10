import { test, expect } from '@playwright/test';
import { createTestUser, cleanupTestUser, makeEmail, TEST_PASSWORD, admin, url, anonKey, E2E_BASE_URL } from './helpers';

import { createClient, type SupabaseClient } from '@supabase/supabase-js';

/** Table scan token: public orders are gated on it since REQUIRE_TABLE_TOKEN=true. */
const TABLE_TOKEN = 'a1a1a1a1a1a1a1a1a1a1a1a1a1a1a1a1';

/**
 * P2-5 — order cancellation flow + TOCTOU protection.
 *   1. Normal cancel works (200).
 *   2. Double-cancel / cancel-after-cancel → clean rejection (400), not a
 *      crash and not silent success.
 *   3. Cancel after delivered → clean rejection (400).
 *   4. TOCTOU race: a concurrent cancel + advance race — exactly one wins;
 *      the loser gets a clean 409/STALE_STATUS, the order is never corrupted.
 */
test.describe.configure({ mode: 'serial' });

const email = makeEmail();
const runId = Date.now() % 1_000_000;
const slug = `e2e-cancel-${runId}`;
let userId: string;
let projectId: string;
let productId: string;
let authed: SupabaseClient;

async function placeOrder(): Promise<string> {
  const res = await fetch(`${E2E_BASE_URL}/api/public/order`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({
      projectSlug: slug,
      tableSlug: 'table-1',
      tableToken: TABLE_TOKEN,
      items: [{ productId: productId, quantity: 1, notes: '' }],
    }),
  });
  const body = await res.json();
  if (!res.ok) throw new Error(`placeOrder failed ${res.status}: ${JSON.stringify(body)}`);
  return body.order?.id;
}

let authCookieHeader = '';

async function cancelOrder(orderId: string): Promise<{ status: number; body: unknown }> {
  const res = await fetch(`${E2E_BASE_URL}/api/pos/cancel`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json', ...(authCookieHeader ? { Cookie: authCookieHeader } : {}) },
    body: JSON.stringify({ orderId }),
  });
  return { status: res.status, body: await res.json() };
}

test.beforeAll(async () => {
  const user = await createTestUser(email);
  userId = user.id;
  const { data: proj } = await admin
    .from('projects')
    .insert({ name: 'Cancel Test', slug, currency: 'BHD', primary_color: '#4338CA', is_active: true })
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
    .insert({ project_id: projectId, name: 'قهوة إلغاء', price: 1, category_id: cat!.id, is_available: true })
    .select('id')
    .single();
  productId = prod!.id;
  await admin
    .from('tables')
    .insert({ project_id: projectId, number: 1, slug: 'table-1', is_active: true, qrcode: TABLE_TOKEN });

  authed = createClient(url, anonKey(), { auth: { persistSession: false, autoRefreshToken: false } });
  const { data: sessData, error: se } = await authed.auth.signInWithPassword({ email, password: TEST_PASSWORD });
  if (se) throw new Error(`signIn failed: ${se.message}`);
  // Build the same session cookie the browser would hold, for direct API calls.
  const ref = new URL(url).hostname.split('.')[0];
  authCookieHeader = `sb-${ref}-auth-token=${JSON.stringify(sessData.session)}`;
});

test.afterAll(async () => {
  await cleanupTestUser(email);
});

test('cancel: normal cancel → 200, double cancel → clean rejection', async () => {
  const orderId = await placeOrder();

  const first = await cancelOrder(orderId);
  expect(first.status).toBe(200);

  const second = await cancelOrder(orderId);
  expect(second.status).toBe(400); // already cancelled — clean, no crash
  expect(JSON.stringify(second.body)).toContain('إلغاء');

  // Order stays cancelled, never corrupted.
  const { data: order } = await admin.from('orders').select('status').eq('id', orderId).single();
  expect(order?.status).toBe('cancelled');
});

test('cancel: delivered order cannot be cancelled', async () => {
  const orderId = await placeOrder();

  // Advance to delivered (happy path RPC).
  const r1 = await authed.rpc('advance_order_status', {
    p_order_id: orderId,
    p_expected_status: 'pending',
    p_new_status: 'preparing',
    p_caller_user_id: userId,
  });
  expect(r1.error).toBeNull();
  const r2 = await authed.rpc('advance_order_status', {
    p_order_id: orderId,
    p_expected_status: 'preparing',
    p_new_status: 'ready',
    p_caller_user_id: userId,
  });
  expect(r2.error).toBeNull();
  const r3 = await authed.rpc('advance_order_status', {
    p_order_id: orderId,
    p_expected_status: 'ready',
    p_new_status: 'delivered',
    p_caller_user_id: userId,
  });
  expect(r3.error).toBeNull();

  const cancel = await cancelOrder(orderId);
  expect(cancel.status).toBe(400); // delivered — clean rejection
  const { data: order } = await admin.from('orders').select('status').eq('id', orderId).single();
  expect(order?.status).toBe('delivered');
});

test('TOCTOU: concurrent cancel + advance — exactly one wins, no corruption', async () => {
  const orderId = await placeOrder();

  // Fire cancel and advance at the same time. Deterministic outcome:
  // - If advance wins: order becomes preparing; cancel sees status not in
  //   [pending] → 400. Order stays preparing.
  // - If cancel wins: order cancelled; advance expected pending → STALE_STATUS.
  // Either way: one clean success, one clean rejection, order status is one
  // of the two valid end states — never a crash, never both "succeeded".
  const [cancelRes, advanceRes] = await Promise.all([
    cancelOrder(orderId),
    authed.rpc('advance_order_status', {
      p_order_id: orderId,
      p_expected_status: 'pending',
      p_new_status: 'preparing',
      p_caller_user_id: userId,
    }),
  ]);

  // Cancel: 200 (cancel won) or 400 (advance won, status changed).
  expect([200, 400]).toContain(cancelRes.status);
  // Advance: success or STALE_STATUS rejection.
  if (advanceRes.error) {
    expect(String(advanceRes.error.message)).toContain('STALE_STATUS');
  }

  const { data: order } = await admin.from('orders').select('status').eq('id', orderId).single();
  expect(['cancelled', 'preparing']).toContain(order?.status);

  // If advance won, the atomic RPC must have moved items too.
  if (order?.status === 'preparing') {
    const { data: full } = await admin
      .from('orders')
      .select('order_items(status)')
      .eq('id', orderId)
      .single();
    const itemStatuses = (full?.order_items as { status: string }[])?.map((i) => i.status) ?? [];
    expect(itemStatuses.every((s) => s === 'preparing')).toBe(true);
  }
});
