import { test, expect } from '@playwright/test';
import { createTestUser, cleanupTestUser, makeEmail, TEST_PASSWORD, admin, url, anonKey, E2E_BASE_URL } from './helpers';

import { createClient, type SupabaseClient } from '@supabase/supabase-js';

/** Table scan token: public orders are gated on it since REQUIRE_TABLE_TOKEN=true. */
const TABLE_TOKEN = '12121212121212121212121212121212';

/**
 * P2-4 — TENANT ISOLATION (the audit's single most important missing test).
 *
 * Staff of Project A attempts to READ and WRITE Project B's data through the
 * authenticated client (RLS layer) — orders, products, tables, categories,
 * projects settings. Every access must be blocked: reads return no rows
 * (RLS), writes fail or affect 0 rows. No cross-tenant leakage at any layer.
 */
test.describe.configure({ mode: 'serial' });

const emailA = makeEmail(); // staff of Project A
const emailB = makeEmail(); // staff of Project B (the victim)
const runId = Date.now() % 1_000_000;

let userAId: string;
let projectAId: string;
let projectBId: string;
let productBId: string;
let tableBId: string;
let orderBId: string;
let authedA: SupabaseClient;

test.beforeAll(async () => {
  // Idempotent: clear any leftovers from a previously interrupted run.
  await cleanupTestUser(emailA);
  await cleanupTestUser(emailB);

  const userA = await createTestUser(emailA);
  userAId = userA.id;
  const userB = await createTestUser(emailB);

  // Project A (attacker)
  const { data: projA } = await admin
    .from('projects')
    .insert({ name: 'Tenant A', slug: `e2e-iso-a-${runId}`, currency: 'BHD', primary_color: '#4338CA', is_active: true })
    .select('id')
    .single();
  projectAId = projA!.id;
  await admin.from('staff_members').insert({ project_id: projectAId, user_id: userAId, role: 'owner' });

  // Project B (victim) with product + table + a real order
  const { data: projB } = await admin
    .from('projects')
    .insert({ name: 'Tenant B', slug: `e2e-iso-b-${runId}`, currency: 'BHD', primary_color: '#4338CA', is_active: true })
    .select('id')
    .single();
  projectBId = projB!.id;
  await admin.from('staff_members').insert({ project_id: projectBId, user_id: userB.id, role: 'owner' });

  const { data: catB } = await admin
    .from('categories')
    .insert({ project_id: projectBId, name: 'b-cat', sort_order: 0 })
    .select('id')
    .single();
  const { data: prodB } = await admin
    .from('products')
    .insert({ project_id: projectBId, name: 'منتج سري ب', price: 9, category_id: catB!.id, is_available: true })
    .select('id')
    .single();
  productBId = prodB!.id;
  const { data: tblB } = await admin
    .from('tables')
    .insert({ project_id: projectBId, number: 1, slug: 'table-1', is_active: true, qrcode: TABLE_TOKEN })
    .select('id')
    .single();
  tableBId = tblB!.id;

  const orderRes = await fetch(`${E2E_BASE_URL}/api/public/order`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({
      projectSlug: `e2e-iso-b-${runId}`,
      tableSlug: 'table-1',
      tableToken: TABLE_TOKEN,
      items: [{ productId: productBId, quantity: 1, notes: '' }],
    }),
  });
  const placed = await orderRes.json();
  orderBId = placed.order?.id;
  expect(orderBId, `order in tenant B should exist: ${JSON.stringify(placed)}`).toBeTruthy();

  authedA = createClient(url, anonKey(), { auth: { persistSession: false, autoRefreshToken: false } });
  const { error: se } = await authedA.auth.signInWithPassword({ email: emailA, password: TEST_PASSWORD });
  if (se) throw new Error(`signIn A failed: ${se.message}`);
});

test.afterAll(async () => {
  await cleanupTestUser(emailA);
  await cleanupTestUser(emailB);
});

test('tenant isolation: staff of A cannot read any of B’s data', async () => {
  // Orders of B — RLS must return zero rows for A.
  const { data: orders } = await authedA.from('orders').select('id').eq('project_id', projectBId);
  expect(orders ?? []).toHaveLength(0);

  // Products of B
  const { data: products } = await authedA.from('products').select('id').eq('project_id', projectBId);
  expect(products ?? []).toHaveLength(0);

  // Tables of B
  const { data: tables } = await authedA.from('tables').select('id').eq('project_id', projectBId);
  expect(tables ?? []).toHaveLength(0);

  // Categories of B
  const { data: cats } = await authedA.from('categories').select('id').eq('project_id', projectBId);
  expect(cats ?? []).toHaveLength(0);

  // Project B row itself
  const { data: proj } = await authedA.from('projects').select('id').eq('id', projectBId);
  expect(proj ?? []).toHaveLength(0);

  // Direct row fetch by id (the "guess an id" attack) also empty.
  const { data: byId } = await authedA.from('orders').select('id, status, total_amount').eq('id', orderBId);
  expect(byId ?? []).toHaveLength(0);
});

test('tenant isolation: staff of A cannot write to B’s data', async () => {
  // Update B's product → 0 rows affected (RLS blocks UPDATE).
  const { data: upd, error: updErr } = await authedA
    .from('products')
    .update({ price: 0.01 })
    .eq('id', productBId)
    .select('id');
  expect(updErr).toBeNull();
  expect(upd ?? []).toHaveLength(0);

  // Verify the price really didn't change.
  const { data: check } = await admin.from('products').select('price').eq('id', productBId).single();
  expect(check?.price).toBe(9);

  // Delete B's table → 0 rows affected.
  const { data: del, error: delErr } = await authedA.from('tables').delete().eq('id', tableBId).select('id');
  expect(delErr).toBeNull();
  expect(del ?? []).toHaveLength(0);
  const { data: tableStill } = await admin.from('tables').select('id').eq('id', tableBId).single();
  expect(tableStill?.id).toBe(tableBId);

  // Insert into B's project (spoof project_id) → blocked by RLS WITH CHECK.
  const { data: ins, error: insErr } = await authedA
    .from('products')
    .insert({ project_id: projectBId, name: 'تسلل', price: 1, is_available: true })
    .select('id');
  expect(insErr).not.toBeNull();
  expect(ins ?? []).toHaveLength(0);

  // Advance B's order via RPC → tenant-membership guard rejects.
  const rpcRes = await authedA.rpc('advance_order_status', {
    p_order_id: orderBId,
    p_expected_status: 'pending',
    p_new_status: 'preparing',
    p_caller_user_id: userAId,
  });
  expect(rpcRes.error, 'cross-tenant RPC must be rejected').not.toBeNull();
  const { data: orderState } = await admin.from('orders').select('status').eq('id', orderBId).single();
  expect(orderState?.status).toBe('pending');
});
