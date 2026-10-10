import { test, expect } from '@playwright/test';
import { createTestUser, cleanupTestUser, makeEmail, admin, E2E_BASE_URL } from './helpers';

/** Table scan token: public orders are gated on it since REQUIRE_TABLE_TOKEN=true. */
const TABLE_TOKEN = 'b1b1b1b1b1b1b1b1b1b1b1b1b1b1b1b1';

/**
 * CRIT-3 (audit 2026-09-26) — offline retry must not create a second order.
 *
 * The customer's failed POST is queued to IndexedDB and replayed verbatim by
 * the service worker. Because the payload carried no stable identifier, a
 * retry of a request that actually SUCCEEDED server-side (the response was
 * lost on a flaky mobile connection) silently created a real second order —
 * the merchant then cooked the same plate twice. Migration 0014 adds a
 * caller-supplied `clientRequestId` enforced by a unique index in the DB, so
 * the replay returns the ORIGINAL order instead.
 *
 * These assertions are deliberately made against the DATABASE, not just the
 * HTTP response: a 200 that quietly wrote a second row would pass a
 * response-only test.
 */
test.describe.configure({ mode: 'serial' });

const runId = Date.now() % 1_000_000;
const slug = `e2e-idem-${runId}`;
// Module-scope, not a function: `beforeAll` runs after the file body, but the
// cleanup in `afterAll` needs the SAME address, and a per-call makeEmail() would
// make afterAll clean up a different (nonexistent) user and leak the fixture.
const email = makeEmail();
let userId: string;
let projectId: string;
let productId: string;

type OrderResponse = {
  status: number;
  body: { order?: { id: string; orderNumber: number; totalAmount: number }; replayed?: boolean; error?: string };
};

async function postOrder(clientRequestId?: string): Promise<OrderResponse> {
  const res = await fetch(`${E2E_BASE_URL}/api/public/order`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({
      projectSlug: slug,
      tableSlug: 'table-1',
      tableToken: TABLE_TOKEN,
      ...(clientRequestId ? { clientRequestId } : {}),
      items: [{ productId, quantity: 1, notes: '' }],
    }),
  });
  return { status: res.status, body: await res.json() };
}

async function countOrdersForKey(key: string): Promise<number> {
  const { count } = await admin
    .from('orders')
    .select('id', { count: 'exact', head: true })
    .eq('project_id', projectId)
    .eq('client_request_id', key);
  return count ?? 0;
}

async function countOrders(projectId: string): Promise<number | null> {
  // head:true returns NO rows, so `data` is null and the count arrives as
  // `count`. Reading `data.length` here (the obvious mistake) is always 0 or a
  // TypeError — the first draft of this spec did exactly that and compared
  // null against a number, which failed for a reason that had nothing to do with
  // the behaviour under test.
  const { count } = await admin
    .from('orders')
    .select('id', { count: 'exact', head: true })
    .eq('project_id', projectId);
  return count;
}

test.beforeAll(async () => {
  const user = await createTestUser(email);
  userId = user.id;
  const { data: proj } = await admin
    .from('projects')
    .insert({ name: 'Idempotency Test', slug, currency: 'BHD', primary_color: '#4338CA', is_active: true })
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
    .insert({ project_id: projectId, name: 'قهوة تكرار', price: 1, category_id: cat!.id, is_available: true })
    .select('id')
    .single();
  productId = prod!.id;
  await admin
    .from('tables')
    .insert({ project_id: projectId, number: 1, slug: 'table-1', is_active: true, qrcode: TABLE_TOKEN });
});

test.afterAll(async () => {
  await cleanupTestUser(email);
});

test('same clientRequestId twice creates exactly ONE order', async () => {
  const key = crypto.randomUUID();

  const first = await postOrder(key);
  expect(first.status).toBe(200);
  expect(first.body.replayed).toBeFalsy();
  const orderId = first.body.order!.id;
  expect(await countOrdersForKey(key)).toBe(1);

  // The retry the service worker performs after connectivity returns.
  const second = await postOrder(key);
  expect(second.status).toBe(200);
  // Same order handed back, not a new one.
  expect(second.body.order!.id).toBe(orderId);
  expect(second.body.order!.orderNumber).toBe(first.body.order!.orderNumber);
  expect(second.body.replayed).toBe(true);

  // The decisive assertion: still ONE row.
  expect(await countOrdersForKey(key)).toBe(1);
});

test('a NEW clientRequestId still creates a separate order (no over-dedupe)', async () => {
  const keyA = crypto.randomUUID();
  const keyB = crypto.randomUUID();

  const a = await postOrder(keyA);
  const b = await postOrder(keyB);
  expect(a.status).toBe(200);
  expect(b.status).toBe(200);

  // Guard against the opposite bug: a fix that dedupes too eagerly would make
  // the second order silently disappear and a customer would never get served.
  expect(b.body.order!.id).not.toBe(a.body.order!.id);
  expect(b.body.order!.orderNumber).not.toBe(a.body.order!.orderNumber);
  expect(b.body.replayed).toBeFalsy();
  expect(await countOrdersForKey(keyA)).toBe(1);
  expect(await countOrdersForKey(keyB)).toBe(1);
});

test('5 rapid retries of the same key still yield one order', async () => {
  const key = crypto.randomUUID();

  // Sequential first, so the first response is authoritative; then hammer it
  // the way a flapping connection would.
  const first = await postOrder(key);
  expect(first.status).toBe(200);

  const results = await Promise.all(Array.from({ length: 5 }, () => postOrder(key)));
  for (const r of results) {
    expect(r.status).toBe(200);
    expect(r.body.order!.id).toBe(first.body.order!.id);
  }
  expect(await countOrdersForKey(key)).toBe(1);
});

test('omitting clientRequestId keeps working (internal callers are unaffected)', async () => {
  const res = await postOrder();
  expect(res.status).toBe(200);
  expect(res.body.order!.id).toBeTruthy();
  expect(res.body.replayed).toBeFalsy();
});

test('a malformed clientRequestId is a clean 400, not a 500', async () => {
  const beforeRows = await countOrders(projectId!);

  const res = await fetch(`${E2E_BASE_URL}/api/public/order`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({
      projectSlug: slug,
      tableSlug: 'table-1',
      tableToken: TABLE_TOKEN,
      clientRequestId: 'not-a-uuid',
      items: [{ productId, quantity: 1, notes: '' }],
    }),
  });
  expect(res.status).toBe(400);

  // The rejection must be total: a rejected key must not have created a
  // partial order. Counted with a plain aggregate rather than filtering on the
  // bad literal, which is not even a uuid.
  expect(await countOrders(projectId!)).toBe(beforeRows);
});
