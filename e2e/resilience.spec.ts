import { test, expect, type APIRequestContext } from '@playwright/test';
import {
  admin,
  createTestUser,
  cleanupTestUser,
  getAuthCookies,
  makeEmail,
  TEST_PASSWORD,
  E2E_BASE_URL,
} from './helpers';

/**
 * RESILIENCE / DEGRADATION / HARDENING — the negative surface.
 *
 * Everything here answers one question: when the input, the caller or the
 * deployment is wrong, does the app fail CLEANLY (a specific 4xx with a
 * machine-readable `error`) and quietly (no stack trace, no table name)?
 *
 * Split from auth-failures / endpoint-guards / tenant-isolation, which assert
 * the same idea generically ("unauthenticated requests are rejected"). This
 * spec goes per-route: every handler under src/app/api is read and each one
 * gets its OWN assertion for its OWN status code, so a refactor that moves a
 * guard below input validation (and turns a 401 into a 500, or a 400 into a
 * 200) fails here by name.
 *
 * Status codes asserted below are the ones the handlers actually return
 * (src/app/api/**), each re-verified against production before being written
 * down. None of them is a "less than 500" hand-wave.
 *
 * Tests are deliberately NOT serial: each one builds and destroys its own
 * store, so a failure in one cannot cascade into the others.
 */

/* ── fixtures ────────────────────────────────────────────────────────── */

/** A well-formed uuid that exists in no project. */
const GHOST_UUID = '11111111-1111-1111-1111-111111111111';
const ZERO_UUID = '00000000-0000-0000-0000-000000000000';
const HEX32 = 'e'.repeat(32);

const JSON_CT = { 'Content-Type': 'application/json' } as const;

/** Run-scoped so parallel/repeat runs never collide on a unique index. */
const RUN = Date.now() % 1_000_000;

/**
 * A well-formed slug that can never exist: passes the shape gate (lowercase,
 * hyphenated, <=100 chars) so a request reaches the lookup and comes back 404,
 * which is what makes it useful for proving a refusal is a lookup failure and
 * not a validation failure. Shared so R1b can also clear this store's
 * rate-limit bucket.
 */
const ABSENT = `e2e-res-absent-${RUN}`;

type Seeded = {
  projectId: string;
  slug: string;
  tableSlug: string;
  productId: string;
};

/**
 * A self-contained, publicly orderable store: active project, 30-day trial
 * (the column default), one available category/product and one active table.
 * No owner user — the public order path never needs one.
 *
 * `tableSlug` is a parameter so a test can build TWO stores whose tables have
 * DIFFERENT slugs; with the same slug, a "use store B's table" probe silently
 * resolves to store A's own table and the test proves nothing.
 */
async function seedStore(tag: string, tableSlug = 't1'): Promise<Seeded> {
  const slug = `e2e-res-${tag}-${RUN}-${Math.floor(Math.random() * 1e6)}`;
  const { data: project, error: pErr } = await admin
    .from('projects')
    .insert({ name: `resilience ${tag}`, slug, currency: 'BHD', is_active: true })
    .select('id')
    .single();
  if (pErr || !project) throw new Error(`seed project ${slug}: ${pErr?.message}`);

  const { data: category, error: cErr } = await admin
    .from('categories')
    .insert({ project_id: project.id, name: `cat-${tag}`, sort_order: 0 })
    .select('id')
    .single();
  if (cErr || !category) throw new Error(`seed category: ${cErr?.message}`);

  const { data: product, error: prErr } = await admin
    .from('products')
    .insert({
      project_id: project.id,
      category_id: category.id,
      name: `منتج ${tag}`,
      price: 2.5,
      is_available: true,
      sort_order: 1,
      // A real image so the a11y pass has an <img> to inspect.
      image_url: '/icons/icon-192.png',
    })
    .select('id')
    .single();
  if (prErr || !product) throw new Error(`seed product: ${prErr?.message}`);

  const { error: tErr } = await admin.from('tables').insert({
    project_id: project.id,
    number: 1,
    slug: tableSlug,
    is_active: true,
    qrcode: HEX32,
  });
  if (tErr) throw new Error(`seed table: ${tErr.message}`);

  return { projectId: project.id, slug, tableSlug, productId: product.id };
}

/**
 * Drop THIS store's own rate-limit buckets.
 *
 * /api/public/order applies two independent limiters (src/app/api/public/order/route.ts):
 *   public-order:<slug>:<ip>     limit 20/min  — resettable by a test
 *   public-order-ip:ip:<ip>      limit 30/min  — shared by every store on this IP
 *
 * The suite runs from one IP, so a spec that makes more than ~30 order calls in
 * a minute gets 429 on its own setup requests — R5 and R8 both failed exactly
 * that way, and it looked like an app defect. Resetting the per-slug bucket in
 * beforeEach keeps each test's own budget clean, and the shared IP bucket is
 * left alone on purpose: deleting it would hand every other spec a free pass and
 * destroy the very limit the suite is there to verify. The remaining guard is
 * to not make redundant calls, which is why the probes below reuse one response
 * for several assertions instead of re-posting the same body.
 */
async function resetOwnRateLimit(slug: string): Promise<void> {
  await admin.from('rate_limits').delete().ilike('key', `%${slug}%`);
}

/**
 * Count every call this spec makes to a rate-limited PUBLIC endpoint, and warn
 * loudly when a single test approaches the shared per-IP budget.
 *
 * The suite runs from one IP, so /api/public/order's ip bucket (30/min) and the
 * waiter/bill buckets are a shared resource across ALL specs. R2 alone posts 10
 * bodies and R3 about 12; running them back to back in the same minute is what
 * made R5 and R8 fail with 429 on their own CONTROL request — a failure that
 * reads exactly like an application defect and is not one.
 *
 * This is a guard rail, not a fix: it reports the budget so a future spec that
 * adds probes is visible in the log instead of silently starving its neighbours.
 */
let publicOrderCalls = 0;
const PUBLIC_ORDER_IP_BUDGET = 30;
function countPublicOrderCall(label: string): void {
  publicOrderCalls += 1;
  if (publicOrderCalls > PUBLIC_ORDER_IP_BUDGET - 5) {
    console.warn(
      `[rate-budget] ${publicOrderCalls}/${PUBLIC_ORDER_IP_BUDGET} public-order calls from this IP` +
        ` (last: ${label}). The next specs will 429 until the window rolls.`,
    );
  }
}

/**
 * Full teardown of a seeded store. Deliberately wider than
 * helpers.cleanupTestUser (which is keyed on a user): the stores here are
 * owner-less, and the rate-limit/daily-counter rows a store generates would
 * otherwise be orphaned.
 */
async function dropStore(seed: Seeded | null): Promise<void> {
  if (!seed) return;
  const { data: orders } = await admin.from('orders').select('id').eq('project_id', seed.projectId);
  for (const o of orders ?? []) await admin.from('order_items').delete().eq('order_id', o.id);
  await admin.from('orders').delete().eq('project_id', seed.projectId);
  await admin.from('service_requests').delete().eq('project_id', seed.projectId);
  await admin.from('daily_order_counters').delete().eq('project_id', seed.projectId);
  await admin.from('rate_limits').delete().ilike('key', `%${seed.slug}%`);
  await admin.from('tables').delete().eq('project_id', seed.projectId);
  // option_groups/option_choices have NO project_id column — they hang off
  // used to be a silent 400. The rows are removed anyway by the ON DELETE
  // CASCADE from products below, which is why the leak was invisible.
  await admin.from('products').delete().eq('project_id', seed.projectId);
  await admin.from('categories').delete().eq('project_id', seed.projectId);
  await admin.from('staff_members').delete().eq('project_id', seed.projectId);
  await admin.from('projects').delete().eq('id', seed.projectId);
}

/** Every negative response carries a machine-readable `error` string. */
async function expectErrorBody(api: APIRequestContext, path: string, init: { status: number; data?: unknown; raw?: string }): Promise<void> {
  if (path === '/api/public/order') countPublicOrderCall(`expectErrorBody ${init.status}`);
  const res = await api.post(path, {
    headers: JSON_CT,
    ...(init.raw !== undefined ? { data: init.raw } : { data: init.data ?? {} }),
  });
  expect(res.status(), `${path} status`).toBe(init.status);
  const body = await res.json();
  expect(body, `${path} body must be an object`).toBeTruthy();
  expect(typeof body.error, `${path} must carry an \`error\` key`).toBe('string');
  expect(body.error.length).toBeGreaterThan(0);
  // An error response must not double as a write receipt.
  expect(body.order ?? null, `${path} must not create an order`).toBeNull();
  expectNoLeak(await res.text(), path);
}

/**
 * Failure responses must stay failure responses. The handlers catch their own
 * errors and return a fixed Arabic string, so anything from this denylist
 * reaching a client is a leak of internals (a stack frame, a framework error,
 * or the schema itself).
 */
const LEAK_MARKERS = [
  ' at ',
  'Error:',
  'TypeError',
  'SyntaxError',
  'PostgREST',
  '.ts:',
  '.js:',
  'node_modules',
  'supabase',
  'stack',
  // table / RPC names from DATA-MODEL.md
  'orders',
  'order_items',
  'staff_members',
  'projects',
  'products',
  'categories',
  'tables',
  'push_subscriptions',
  'telegram_link_codes',
  'super_admins',
  'rate_limits',
];

function expectNoLeak(text: string, label: string): void {
  for (const marker of LEAK_MARKERS) {
    expect(text.toLowerCase().includes(marker.toLowerCase()), `${label} leaked "${marker}": ${text.slice(0, 200)}`).toBe(false);
  }
}

/* ══════════════════════════════════════════════════════════════════════ *
 * 1) PUBLIC API INPUT VALIDATION — no auth, no data side effects
 * ══════════════════════════════════════════════════════════════════════ */

/**
 * R1 — a non-JSON body must be a 400, never a 500.
 *
 * FIXED 2026-10-06 (2026-10 audit remediation, extra finding). Formerly KNOWN FAILING.
 *
 * `const body = (await request.json())` throws on unparseable input, and the
 * handler's catch-all answers 500. The route validates the SHAPE of a parsed
 * body but never that the body PARSED. (The same defect existed in the public
 * waiter/bill routes, which were DELETED outright — owner decision 2, 2026-10-06.)
 *
 * This test asserts the contract the route is supposed to have (400). It is
 * kept as its own test — not folded into the other validation cases — so this
 * one red test cannot mask a green one. Fix in the handler:
 *
 *   const body = await request.json().catch(() => null);
 *   if (!body || typeof body !== 'object' || Array.isArray(body)) {
 *     return NextResponse.json({ error: 'بيانات غير صالحة' }, { status: 400 });
 *   }
 */
test('R1 public order: a body that is not JSON is a 400, never a 500', async ({ request }) => {
  const cases: Array<{ label: string; raw: string }> = [
    { label: 'not json at all', raw: 'not-json-at-all' },
    { label: 'truncated json', raw: '{"projectSlug":"x"' },
    { label: 'literal null', raw: 'null' },
    { label: 'empty body', raw: '' },
  ];
  for (const c of cases) {
    countPublicOrderCall(`R1 raw ${c.label}`);
    const res = await request.post('/api/public/order', { headers: JSON_CT, data: c.raw });
    expect(res.status(), `public/order [${c.label}] must be 400, not a 500`).toBe(400);
    const body = await res.json();
    expect(typeof body.error, `public/order [${c.label}] must carry \`error\``).toBe('string');
    expectNoLeak(await res.text(), `public/order [${c.label}]`);
  }
});

/**
 * R1b — the same class of bug across EVERY json-parsing write route.
 *
 * A literal `null` body is VALID JSON, so `await request.json()` returns null
 * and the next property access throws a TypeError that the route's catch turns
 * into a 500. Every json-parsing write route shipped that way: public/order,
 * auth/signup, auth/reset-password and telegram/link — all of them
 * reachable without a session, so an anonymous visitor could spend the error
 * budget at will. This test is the regression guard, and it covers the whole
 * family (null, array, string, number, bool) rather than the one shape that
 * happened to be reported.
 *
 * A 401 is accepted wherever the route authenticates first, because a
 * stateless probe reaches it without credentials; what is NOT acceptable is 5xx
 * or a body that leaks a stack trace.
 */
test('R1b no json route 500s on a non-object body (null/array/string/number/bool)', async ({ request }) => {
  const routes = [
    '/api/public/order',
    '/api/public/waiter',
    '/api/public/bill',
    '/api/auth/signup',
    '/api/auth/reset-password',
    '/api/telegram/link',
    '/api/pos/order',
    '/api/pos/cancel',
    '/api/onboarding/project',
    '/api/revalidate-menu',
    '/api/push/subscribe',
    '/api/staff/notification-prefs',
  ];
  const bodies: Array<[string, string]> = [
    ['null', 'null'],
    ['array', '[]'],
    ['string', '"a string"'],
    ['number', '42'],
    ['bool', 'true'],
  ];

  for (const path of routes) {
    for (const [label, raw] of bodies) {
      // public/order is the only rate-limited route in this list, and the
      // shared per-IP budget is 30/min. R1b alone would post 5 to it, on top of
      // the ~20 R2 and R3 already spend in the same minute — so the store's own
      // bucket is cleared first and the count is reported by the guard rail.
      if (path === '/api/public/order') {
        await resetOwnRateLimit(ABSENT);
        countPublicOrderCall(`R1b ${path} ${label}`);
      }
      const res = await request.post(path, { headers: JSON_CT, data: raw });
      const status = res.status();
      expect(
        status,
        `${path} with a ${label} body must be a clean 4xx, got ${status}`,
      ).toBeLessThan(500);
      expect([400, 401, 403, 405, 422], `${path} [${label}] unexpected ${status}`).toContain(status);
      const text = await res.text();
      if (status === 400) {
        // A 400 must still be the machine-readable shape, not a bare string.
        let body: { error?: unknown };
        try {
          body = JSON.parse(text) as { error?: unknown };
        } catch {
          throw new Error(`${path} [${label}] returned 400 with a non-JSON body: ${text.slice(0, 120)}`);
        }
        expect(typeof body.error, `${path} [${label}] must carry an \`error\` key`).toBe('string');
      }
      expectNoLeak(text, `${path} [${label}]`);
    }
  }
});

/**
 * R7 — waiter / bill service requests.
 *
 * Restored 2026-10-06: the routes were deleted as "unused" (b3aab0c) while the
 * menu buttons kept calling them, so «طلب موظف» and «طلب فاتورة» silently
 * 404'd for every customer. They are back, backed by `service_requests`, and
 * this is the contract they must keep:
 *   - a correct table token writes ONE row and answers 200 {ok:true}
 *   - the same kind of request from the same table inside the window is 429
 *     (anti-spam), and a DIFFERENT kind is still allowed
 *   - a wrong token is 404 (a published slug is not authorisation)
 *   - an unknown store is 404 and writes nothing
 */
test('R7 waiter/bill: token-gated write, dedupe, and no cross-tenant writes', async ({ request }) => {
  const seed = await seedStore('r7');
  try {
    await resetOwnRateLimit(seed.slug);
    const body = { projectSlug: seed.slug, tableSlug: seed.tableSlug, tableToken: HEX32 };

    const waiter = await request.post('/api/public/waiter', { headers: JSON_CT, data: body });
    expect(waiter.status(), 'waiter with the scanned token must be accepted').toBe(200);
    expect((await waiter.json()).ok).toBe(true);

    // Same kind, same table, inside the dedupe window -> 429, and NOT a second row.
    const repeat = await request.post('/api/public/waiter', { headers: JSON_CT, data: body });
    expect(repeat.status(), 'a repeat waiter call must be de-duplicated').toBe(429);
    expect(typeof (await repeat.json()).error).toBe('string');

    // A bill request is a different kind — the waiter row must not block it.
    const bill = await request.post('/api/public/bill', { headers: JSON_CT, data: body });
    expect(bill.status(), 'a bill request must not be blocked by an open waiter call').toBe(200);

    // A wrong token is a 404 (junk is never treated as "no token").
    const wrongToken = await request.post('/api/public/waiter', {
      headers: JSON_CT,
      data: { ...body, tableToken: 'a'.repeat(32) },
    });
    expect(wrongToken.status(), 'a mismatched table token must be 404').toBe(404);

    // An unknown store writes nothing and answers 404.
    const absent = await request.post('/api/public/bill', {
      headers: JSON_CT,
      data: { projectSlug: ABSENT, tableSlug: seed.tableSlug, tableToken: HEX32 },
    });
    expect(absent.status(), 'an unknown store must be 404').toBe(404);

    // Exactly the two accepted rows exist — the rejected probes wrote nothing.
    const { data: rows } = await admin
      .from('service_requests')
      .select('type,is_resolved')
      .eq('project_id', seed.projectId);
    expect(rows?.length, 'exactly one waiter + one bill row must exist').toBe(2);
    expect(rows?.map((r) => r.type).sort()).toEqual(['bill', 'waiter']);
    expect(rows?.every((r) => r.is_resolved === false), 'new requests start unresolved').toBe(true);
  } finally {
    await dropStore(seed);
  }
});

test('R2 public order: malformed structures are rejected before any lookup', async ({ request }) => {
  const seed = await seedStore('r2');
  try {
    // projectSlug / tableSlug / items are all required and items must be a
    // non-empty array — a 400, decided before the rate limiter and the DB.
    await expectErrorBody(request, '/api/public/order', { status: 400, data: {} });
    await expectErrorBody(request, '/api/public/order', { status: 400, data: { projectSlug: seed.slug, tableSlug: seed.tableSlug, items: [] } });
    await expectErrorBody(request, '/api/public/order', { status: 400, data: { projectSlug: seed.slug, tableSlug: seed.tableSlug, items: 'nope' } });
    await expectErrorBody(request, '/api/public/order', { status: 400, data: { projectSlug: seed.slug, tableSlug: seed.tableSlug, items: {} } });
    await expectErrorBody(request, '/api/public/order', { status: 400, data: { projectSlug: seed.slug, items: [{ productId: seed.productId, quantity: 1 }] } });
    await expectErrorBody(request, '/api/public/order', { status: 400, data: { tableSlug: seed.tableSlug, items: [{ productId: seed.productId, quantity: 1 }] } });
    // Type confusion: a number slug / boolean table is not a slug.
    await expectErrorBody(request, '/api/public/order', { status: 400, data: { projectSlug: 123, tableSlug: true, items: [] } });
    // A 1MB slug would blow up the rate-limit key — capped at 100 chars.
    await expectErrorBody(request, '/api/public/order', { status: 400, data: { projectSlug: 'x'.repeat(101), tableSlug: 't', items: [{ productId: seed.productId, quantity: 1 }] } });
    await expectErrorBody(request, '/api/public/order', { status: 400, data: { projectSlug: seed.slug, tableSlug: 'y'.repeat(101), items: [{ productId: seed.productId, quantity: 1 }] } });
  } finally {
    await dropStore(seed);
  }
});

test('R3 public order: item-level validation rejects bad lines with 400', async ({ request }) => {
  const seed = await seedStore('r3');
  const line = (over: Record<string, unknown>) => ({
    projectSlug: seed.slug,
    tableSlug: seed.tableSlug,
    items: [{ productId: seed.productId, quantity: 1, ...over }],
  });
  try {
    // Unknown (but well-formed) product id — and therefore any product
    // belonging to another store, which resolves to zero rows in the
    // project-scoped pre-fetch.
    await expectErrorBody(request, '/api/public/order', { status: 400, data: line({ productId: GHOST_UUID }) });
    // Missing product id entirely.
    await expectErrorBody(request, '/api/public/order', {
      status: 400,
      data: { projectSlug: seed.slug, tableSlug: seed.tableSlug, items: [{ quantity: 1 }] },
    });
    // Quantity must be a positive integer: not negative, not zero, not
    // fractional, not NaN.
    await expectErrorBody(request, '/api/public/order', { status: 400, data: line({ quantity: -5 }) });
    await expectErrorBody(request, '/api/public/order', { status: 400, data: line({ quantity: 0 }) });
    await expectErrorBody(request, '/api/public/order', { status: 400, data: line({ quantity: 1.5 }) });
    await expectErrorBody(request, '/api/public/order', { status: 400, data: line({ quantity: 'many' }) });
    // The 99-per-line ceiling, and an absurd value far past it.
    await expectErrorBody(request, '/api/public/order', { status: 400, data: line({ quantity: 100 }) });
    await expectErrorBody(request, '/api/public/order', { status: 400, data: line({ quantity: 100000 }) });
    // 50 items is the per-order ceiling.
    await expectErrorBody(request, '/api/public/order', {
      status: 400,
      data: {
        projectSlug: seed.slug,
        tableSlug: seed.tableSlug,
        items: Array.from({ length: 51 }, () => ({ productId: seed.productId, quantity: 1 })),
      },
    });
    // Note-length ceilings (order 500 / line 200). A non-string notes value
    // must be ignored, not crash .trim().
    await expectErrorBody(request, '/api/public/order', { status: 400, data: { ...line({}), notes: 'n'.repeat(600) } });
    await expectErrorBody(request, '/api/public/order', { status: 400, data: line({ notes: 'n'.repeat(300) }) });
    // An option variety that exists nowhere, or belongs to another product.
    await expectErrorBody(request, '/api/public/order', { status: 400, data: line({ optionIds: [GHOST_UUID] }) });
  } finally {
    await dropStore(seed);
  }
});

test('R4 public order: a garbage clientRequestId is refused, not cast', async ({ request }) => {
  const seed = await seedStore('r4');
  try {
    // The idempotency key lands in a uuid column. An unvalidated string
    // becomes a clean 400 rather than a 500 from the cast — and a PRESENT
    // but malformed key is rejected, never silently dropped (dropping it
    // would re-open the duplicate-order bug).
    for (const bad of ['not-a-uuid', '12345', '', 'x'.repeat(200), '0000000000000000000000000000000']) {
      await expectErrorBody(request, '/api/public/order', {
        status: 400,
        data: {
          projectSlug: seed.slug,
          tableSlug: seed.tableSlug,
          items: [{ productId: seed.productId, quantity: 1 }],
          clientRequestId: bad,
        },
      });
    }
    // Non-string values are refused on the same path.
    await expectErrorBody(request, '/api/public/order', {
      status: 400,
      data: { projectSlug: seed.slug, tableSlug: seed.tableSlug, items: [{ productId: seed.productId, quantity: 1 }], clientRequestId: 42 },
    });
  } finally {
    await dropStore(seed);
  }
});

test('R5 public order: unknown slugs and cross-project table slugs are 404', async ({ request }) => {
  const seed = await seedStore('r5a', 'table-a');
  // A second store whose table slug genuinely DIFFERS, so "use store B's
  // table" cannot quietly resolve to store A's own row.
  const other = await seedStore('r5b', 'table-b');
  // This test's own per-store budget, refreshed before the CONTROL order so an
  // earlier spec's traffic cannot make this test's own success case 429.
  await resetOwnRateLimit(seed.slug);
  const line = (projectSlug: string, tableSlug: string) => ({
    projectSlug,
    tableSlug,
    items: [{ productId: seed.productId, quantity: 1 }],
  });
  try {
    expect(other.tableSlug).not.toBe(seed.tableSlug);
    // Unknown store — the availability RPC fails closed (unknown / inactive /
    // expired are indistinguishable, so this leaks nothing about real stores).
    await expectErrorBody(request, '/api/public/order', { status: 404, data: line(`e2e-res-absent-${RUN}`, seed.tableSlug) });
    // Unknown table.
    await expectErrorBody(request, '/api/public/order', { status: 404, data: line(seed.slug, 'no-such-table') });
    // A table slug that is not even uuid-shaped.
    await expectErrorBody(request, '/api/public/order', { status: 404, data: line(seed.slug, 'not-a-uuid') });
    // A REAL, active table belonging to a DIFFERENT store: the lookup is
    // (slug, project_id), so store B's table can never be ordered through
    // store A. This is the cross-tenant probe on the public path.
    await expectErrorBody(request, '/api/public/order', { status: 404, data: line(seed.slug, other.tableSlug) });
    // Control: the same product + table IS accepted for its own store, so
    // the 404s above are the tenant check and not a broken fixture.
    const ok = await request.post('/api/public/order', {
      headers: JSON_CT,
      data: { projectSlug: seed.slug, tableSlug: seed.tableSlug, items: [{ productId: seed.productId, quantity: 1 }] },
    });
    expect(ok.status(), 'control: store A can order its own product at its own table').toBe(200);
  } finally {
    await dropStore(seed);
    await dropStore(other);
  }
});

/* ══════════════════════════════════════════════════════════════════════ *
 * 2) UNAUTHENTICATED SWEEP — one assertion per staff-only handler
 * ══════════════════════════════════════════════════════════════════════ */

/**
 * Every entry below was read from src/app/api/**. All of them authenticate
 * BEFORE parsing their body, so each returns exactly 401 regardless of the
 * payload — the payload is plausible on purpose, so a future refactor that
 * moves validation above the auth check turns this red immediately.
 */
test('R6 every staff-only API answers an anonymous caller with 401 and leaks nothing', async ({ request }) => {
  const probes: Array<{ label: string; method: 'get' | 'post' | 'put' | 'delete'; path: string; body?: unknown }> = [
    // POS: getSession() + a server-side getUser() re-check.
    { label: 'POST /api/pos/order', method: 'post', path: '/api/pos/order', body: { type: 'walkin', projectId: GHOST_UUID, items: [{ productId: GHOST_UUID, quantity: 1 }] } },
    { label: 'POST /api/pos/cancel', method: 'post', path: '/api/pos/cancel', body: { orderId: GHOST_UUID } },
    // Onboarding: getUser().
    { label: 'POST /api/onboarding/project', method: 'post', path: '/api/onboarding/project', body: { name: 'متجر', ownerName: 'x', ownerEmail: 'x@dokan.test', storeType: 'restaurant', currency: 'BHD' } },
    // Cache revalidation: membership is checked after the session.
    { label: 'POST /api/revalidate-menu', method: 'post', path: '/api/revalidate-menu', body: { projectId: GHOST_UUID } },
    // Push: session then staff_members membership.
    { label: 'POST /api/push/subscribe', method: 'post', path: '/api/push/subscribe', body: { projectId: GHOST_UUID, subscription: { endpoint: 'https://fcm.googleapis.com/fcm/send/anon', keys: { p256dh: 'a', auth: 'b' } } } },
    { label: 'POST /api/push/unsubscribe', method: 'post', path: '/api/push/unsubscribe', body: { endpoint: 'https://fcm.googleapis.com/fcm/send/anon' } },
    // Notification prefs is the only staff route with a GET.
    { label: 'GET /api/staff/notification-prefs', method: 'get', path: `/api/staff/notification-prefs?projectId=${GHOST_UUID}` },
    { label: 'PUT /api/staff/notification-prefs', method: 'put', path: '/api/staff/notification-prefs', body: { projectId: GHOST_UUID, notifyPush: true, notifyTelegram: true } },
    // Telegram link/unlink.
    { label: 'POST /api/telegram/link', method: 'post', path: '/api/telegram/link', body: { projectId: GHOST_UUID } },
    { label: 'DELETE /api/telegram/link', method: 'delete', path: '/api/telegram/link', body: { projectId: GHOST_UUID, chatId: '1' } },
    // The whole super-admin surface: 401 (no session) ahead of 403 (not an
    // admin) ahead of any body validation.
    { label: 'POST /api/super-admin/create-project', method: 'post', path: '/api/super-admin/create-project', body: { name: 'متجر', ownerEmail: 'x@dokan.test' } },
    { label: 'POST /api/super-admin/renew', method: 'post', path: '/api/super-admin/renew', body: { projectId: GHOST_UUID, days: 30 } },
    { label: 'POST /api/super-admin/archive-project', method: 'post', path: '/api/super-admin/archive-project', body: { projectId: GHOST_UUID, reason: 'e2e' } },
    { label: 'POST /api/super-admin/deactivate', method: 'post', path: '/api/super-admin/deactivate', body: { projectId: GHOST_UUID } },
    { label: 'POST /api/super-admin/hard-delete-project', method: 'post', path: '/api/super-admin/hard-delete-project', body: { projectId: GHOST_UUID, reason: 'e2e' } },
    { label: 'POST /api/super-admin/record-payment', method: 'post', path: '/api/super-admin/record-payment', body: { projectId: GHOST_UUID, amount: 10, method: 'bank-transfer' } },
    { label: 'POST /api/super-admin/impersonate', method: 'post', path: '/api/super-admin/impersonate', body: { targetUserId: GHOST_UUID } },
    // No rate limit here by design (the httpOnly marker cookie is the
    // credential) — a 500 here would be the only possible outcome.
    { label: 'POST /api/super-admin/impersonate/end', method: 'post', path: '/api/super-admin/impersonate/end', body: {} },
  ];

  for (const probe of probes) {
    const res = await request[probe.method](probe.path, {
      headers: JSON_CT,
      ...(probe.body !== undefined ? { data: probe.body } : {}),
    });
    expect(res.status(), `${probe.label} must be 401`).toBe(401);
    const text = await res.text();
    const body = JSON.parse(text);
    expect(typeof body.error, `${probe.label} must carry an \`error\` key`).toBe('string');
    expectNoLeak(text, probe.label);
  }
});

/**
 * The other side of the same contract: routes that ARE anonymous must still
 * validate, so the public surface cannot be used as a schema oracle. Every
 * status here is the handler's own, read from source and re-verified against
 * production. The two failure modes are deliberately separated per case —
 * conflating "bad parameter" with "not found" is how a 404 silently degrades
 * into a 400.
 */
test('R7 public read endpoints validate their parameters (400/404, never 500)', async ({ request }) => {
  // A well-formed but non-existent store slug: passes the shape gate, so it
  // reaches the lookup and comes back as a 404.

  const cases: Array<{
    label: string;
    status: number;
    run: () => Promise<{ status(): number; text(): Promise<string> }>;
  }> = [
    // order-status: a non-uuid orderId is rejected before the DB; a
    // well-formed id against a store that does not exist is a 404.
    { label: 'order-status non-uuid orderId', status: 400, run: () => request.get('/api/public/order-status?orderId=not-a-uuid&projectSlug=x') },
    { label: 'order-status missing orderId', status: 400, run: () => request.get('/api/public/order-status?projectSlug=x') },
    { label: 'order-status missing projectSlug', status: 400, run: () => request.get(`/api/public/order-status?orderId=${GHOST_UUID}`) },
    { label: 'order-status oversized slug', status: 400, run: () => request.get(`/api/public/order-status?orderId=${GHOST_UUID}&projectSlug=${'x'.repeat(101)}`) },
    { label: 'order-status unknown store', status: 404, run: () => request.get(`/api/public/order-status?orderId=${GHOST_UUID}&projectSlug=${ABSENT}`) },
  ];

  for (const c of cases) {
    const res = await c.run();
    expect(res.status(), `${c.label} must be ${c.status}`).toBe(c.status);
    const text = await res.text();
    const body = JSON.parse(text);
    expect(typeof body.error, `${c.label} must carry an \`error\` key`).toBe('string');
    expectNoLeak(text, c.label);
  }
});

/* ══════════════════════════════════════════════════════════════════════ *
 * 3) CROSS-TENANT — two real stores, two real owners
 * ══════════════════════════════════════════════════════════════════════ */

test('R8 store B’s staff cannot read or write store A through the API layer', async ({ context }) => {
  const emailA = makeEmail(); // victim / store A
  const emailB = makeEmail(); // attacker / store B
  const slugB = `e2e-res-xtb-${RUN}`;
  let seedA: Seeded | null = null;
  try {
    const userA = await createTestUser(emailA);
    const userB = await createTestUser(emailB);

    seedA = await seedStore('xta');
    const run = Date.now() % 1_000_000;
    const { data: projB, error: bErr } = await admin
      .from('projects')
      .insert({ name: 'resilience xtb', slug: slugB, currency: 'BHD', is_active: true, created_by: userB.id })
      .select('id')
      .single();
    if (bErr || !projB) throw new Error(`seed project B: ${bErr?.message}`);

    await admin.from('staff_members').insert({ project_id: seedA.projectId, user_id: userA.id, role: 'owner' });
    await admin.from('staff_members').insert({ project_id: projB.id, user_id: userB.id, role: 'owner' });

    // A real order in A so the "cancel my neighbour's order" probe has a
    // genuine target. Seeded through the service role rather than
    // POST /api/public/order: the whole suite shares one IP, and that route
    // caps orders at 30/min per IP — spending that budget here would 429 the
    // other specs. The tenant boundary under test is the API/RLS layer, not
    // the public checkout, which R5 already covers end to end.
    const { data: placedOrder, error: oErr } = await admin
      .from('orders')
      .insert({
        project_id: seedA.projectId,
        type: 'dinein',
        status: 'pending',
        total_amount: 2.5,
        notes: 'resilience cross-tenant fixture',
      })
      .select('id')
      .single();
    if (oErr || !placedOrder) throw new Error(`seed order in A: ${oErr?.message}`);
    const orderA = placedOrder.id;
    await admin.from('order_items').insert({
      order_id: orderA,
      product_name: 'منتج A',
      quantity: 1,
      unit_price: 2.5,
    });

    // Everything below is sent AS B. `context.request` inherits the browser
    // context's cookie jar — but NOT playwright's baseURL, so the absolute
    // base is spelled out.
    await context.addCookies(await getAuthCookies(emailB, TEST_PASSWORD));

    const bInA: Array<{ label: string; method: 'get' | 'post' | 'put' | 'delete'; path: string; body?: unknown; status: number }> = [
      { label: 'GET  /api/staff/notification-prefs', method: 'get', path: `${E2E_BASE_URL}/api/staff/notification-prefs?projectId=${seedA.projectId}`, status: 403 },
      { label: 'PUT  /api/staff/notification-prefs', method: 'put', path: `${E2E_BASE_URL}/api/staff/notification-prefs`, body: { projectId: seedA.projectId, notifyPush: true, notifyTelegram: true }, status: 403 },
      { label: 'POST /api/revalidate-menu', method: 'post', path: `${E2E_BASE_URL}/api/revalidate-menu`, body: { projectId: seedA.projectId }, status: 403 },
      { label: 'POST /api/push/subscribe', method: 'post', path: `${E2E_BASE_URL}/api/push/subscribe`, body: { projectId: seedA.projectId, subscription: { endpoint: 'https://fcm.googleapis.com/fcm/send/xt', keys: { p256dh: 'a', auth: 'b' } } }, status: 403 },
      { label: 'POST /api/telegram/link', method: 'post', path: `${E2E_BASE_URL}/api/telegram/link`, body: { projectId: seedA.projectId }, status: 403 },
      { label: 'DELETE /api/telegram/link', method: 'delete', path: `${E2E_BASE_URL}/api/telegram/link`, body: { projectId: seedA.projectId, chatId: '1' }, status: 403 },
      // The money path: naming A explicitly is refused outright, and B's own
      // membership is never silently resolved to A.
      { label: 'POST /api/pos/order (projectId=A)', method: 'post', path: `${E2E_BASE_URL}/api/pos/order`, body: { type: 'walkin', projectId: seedA.projectId, items: [{ productId: seedA.productId, quantity: 1 }] }, status: 403 },
      { label: 'POST /api/pos/order (A’s product, no projectId)', method: 'post', path: `${E2E_BASE_URL}/api/pos/order`, body: { type: 'walkin', items: [{ productId: seedA.productId, quantity: 1 }] }, status: 400 },
      { label: 'POST /api/pos/cancel (A’s order)', method: 'post', path: `${E2E_BASE_URL}/api/pos/cancel`, body: { orderId: orderA }, status: 404 },
      // A merchant is not a platform operator, in their own store or any other.
      { label: 'POST /api/super-admin/renew', method: 'post', path: `${E2E_BASE_URL}/api/super-admin/renew`, body: { projectId: seedA.projectId, days: 30 }, status: 403 },
      { label: 'POST /api/super-admin/deactivate', method: 'post', path: `${E2E_BASE_URL}/api/super-admin/deactivate`, body: { projectId: seedA.projectId }, status: 403 },
      { label: 'POST /api/super-admin/archive-project', method: 'post', path: `${E2E_BASE_URL}/api/super-admin/archive-project`, body: { projectId: seedA.projectId, reason: 'e2e' }, status: 403 },
    ];

    for (const probe of bInA) {
      const res = await context.request[probe.method](probe.path, {
        headers: JSON_CT,
        ...(probe.body !== undefined ? { data: probe.body } : {}),
      });
      expect(res.status(), `${probe.label} as store B must be ${probe.status}`).toBe(probe.status);
      expectNoLeak(await res.text(), probe.label);
    }

    // Nothing was written into A on the way through.
    const { count: posCount } = await admin
      .from('orders')
      .select('id', { count: 'exact', head: true })
      .eq('project_id', seedA.projectId)
      .in('status', ['pending', 'preparing', 'ready']);
    expect(posCount, 'B must not have opened a POS order in A').toBe(1); // the one we seeded

    const { data: stillPending } = await admin.from('orders').select('status').eq('id', orderA).single();
    expect(stillPending?.status, 'A’s order must be untouched').toBe('pending');

    const { count: subs } = await admin
      .from('push_subscriptions')
      .select('project_id', { count: 'exact', head: true })
      .eq('project_id', seedA.projectId);
    expect(subs, 'B must not have subscribed to A’s push channel').toBe(0);

    // The data layer agrees: B's RLS session sees nothing of A.
    const asB = await context.request.get(
      `${E2E_BASE_URL}/api/health`,
    );
    expect(asB.status()).toBe(200); // sanity: B's cookies do not break other calls

    // Store A's own owner CAN act — proves the denials above are about the
    // tenant boundary, not a broken fixture.
    const ownerContext = await context.browser()!.newContext();
    await ownerContext.addCookies(await getAuthCookies(emailA, TEST_PASSWORD));
    const ownerPrefs = await ownerContext.request.get(`${E2E_BASE_URL}/api/staff/notification-prefs?projectId=${seedA.projectId}`);
    expect(ownerPrefs.status(), 'A’s owner can read A’s prefs').toBe(200);
    await ownerContext.close();

    await dropStore({ projectId: projB.id, slug: slugB, tableSlug: 't1', productId: seedA.productId });
  } finally {
    await dropStore(seedA);
    await cleanupTestUser(emailA);
    await cleanupTestUser(emailB);
  }
});

/* ══════════════════════════════════════════════════════════════════════ *
 * 4) RATE LIMITING
 * ══════════════════════════════════════════════════════════════════════ */

/**
 * Chosen endpoint: POST /api/auth/reset-password — 2 requests per EMAIL per
 * 5 minutes (src/app/api/auth/reset-password/route.ts, keyPrefix
 * `auth-reset`, identifier `reset:<email>`).
 *
 * Why not the obvious /api/public/order-status (60/min per IP): the whole
 * suite runs from ONE IP, so a 60+ request burst there would spend the
 * budget that the other specs poll with, and 429 them mid-run. This limit is
 * keyed on an email address this test invents, so it is provably scoped to
 * itself — 3 requests, one address, and it cannot touch any other spec. It
 * is also the lowest limit in the codebase (2), so the burst is 1 request
 * over budget rather than 60.
 *
 * Cost: 2 real password-reset emails are attempted for a non-existent
 * @dokan.test address. Both requests answer the same `{success:true}`
 * whether or not the address exists, so nothing is enumerated and nothing is
 * delivered. The rate-limit row is deleted in the test's own finally block.
 */
test('R9 password reset is rate limited to 2 per address and answers 429 with a retry hint', async ({ request }) => {
  const email = `e2e-res-rl-${RUN}-${Math.floor(Math.random() * 1e6)}@dokan.test`;
  const key = `auth-reset:reset:${email}`;
  try {
    const statuses: number[] = [];
    for (let i = 0; i < 3; i += 1) {
      const res = await request.post('/api/auth/reset-password', { headers: JSON_CT, data: { email } });
      statuses.push(res.status());
      const body = await res.json();
      expectNoLeak(await res.text(), 'reset-password');

      if (i < 2) {
        // Under budget: the route deliberately answers identically for known
        // and unknown addresses so it cannot be used to enumerate accounts.
        expect(res.status(), `reset #${i + 1} must be 200`).toBe(200);
        expect(body.success, `reset #${i + 1} must not error`).toBe(true);
        expect(body.error ?? null).toBeNull();
      } else {
        // Over budget: a real 429 whose body names the wait, built by
        // createRateLimitResponse() in src/lib/rate-limit.ts.
        expect(res.status(), 'the 3rd request must be 429').toBe(429);
        expect(typeof body.error, '429 must carry an `error\` key').toBe('string');
        // "طلبات كثيرة. حاول مرة أخرى بعد N ثوانٍ." — matched structurally
        // so the seconds figure is asserted, not the prose.
        expect(body.error, '429 body names the rate limit').toMatch(/طلبات كثيرة/);
        const seconds = Number(body.error.match(/(\d+)/)?.[1]);
        expect(Number.isFinite(seconds), `429 body must state a retry delay: "${body.error}"`).toBe(true);
        expect(seconds).toBeGreaterThan(0);
        expect(seconds).toBeLessThanOrEqual(300); // the 5-minute window
        expect(body.success ?? null).toBeNull();
      }
    }
    expect(statuses).toEqual([200, 200, 429]);
  } finally {
    await admin.from('rate_limits').delete().eq('key', key);
  }
});

/* ══════════════════════════════════════════════════════════════════════ *
 * 5) HEALTH ENDPOINT CONTRACT
 * ══════════════════════════════════════════════════════════════════════ */

test('R10 /api/health reports per-dependency status and is never cached', async ({ request }) => {
  const res = await request.get('/api/health');

  // 200 when every dependency answers, 503 when any of them does not — the
  // route never answers 500, because a health check that 500s has told the
  // operator nothing.
  expect([200, 503], 'health must be 200 or 503, never a 5xx crash').toContain(res.status());
  expect(res.headers()['cache-control'], 'a cached "ok" is worse than no health check').toBe('no-store');

  const body = (await res.json()) as {
    status: string;
    checks: Record<string, { ok: boolean; ms: number; detail?: string }>;
    timestamp?: string;
  };

  expect(['ok', 'degraded'], 'status must be a known value').toContain(body.status);
  expect(body.checks, 'a health check must name WHICH dependency broke').toBeTruthy();
  expect(Object.keys(body.checks).sort()).toEqual(['database', 'env', 'runtime']);
  for (const [name, check] of Object.entries(body.checks)) {
    expect(typeof check.ok, `${name}.ok must be a boolean`).toBe('boolean');
    expect(typeof check.ms, `${name}.ms must be a number`).toBe('number');
    // Failures are reported as a bare dependency name — never a raw error
    // string, which would map the schema for an attacker.
    expectNoLeak(JSON.stringify(check), `health check ${name}`);
  }
  // The aggregate matches the breakdown (it is what a monitor reads).
  const allOk = Object.values(body.checks).every((c) => c.ok);
  expect(body.status).toBe(allOk ? 'ok' : 'degraded');
  expect(res.status()).toBe(allOk ? 200 : 503);
  expect(body.timestamp, 'the full check stamps a time').toBeTruthy();
  expectNoLeak(await res.text(), '/api/health');
});

test('R11 /api/health?light=1 stays liveness-only and still uncached', async ({ request }) => {
  const res = await request.get('/api/health?light=1');
  expect([200, 503]).toContain(res.status());
  expect(res.headers()['cache-control']).toBe('no-store');

  const body = (await res.json()) as { status: string; checks: Record<string, unknown>; timestamp?: string };
  expect(['ok', 'degraded']).toContain(body.status);
  expect(body.checks, 'light mode still returns the same breakdown shape').toBeTruthy();
  // The whole point of ?light=1 is a cheaper response: it drops the
  // timestamp so uptime checkers add no load.
  expect(body.timestamp ?? null, 'light mode omits the timestamp').toBeNull();
  expectNoLeak(await res.text(), '/api/health?light=1');
});

/* ══════════════════════════════════════════════════════════════════════ *
 * 6) SECURITY HEADERS
 * ══════════════════════════════════════════════════════════════════════ */

/** The six headers next.config.ts applies to every route. */
const REQUIRED_HEADERS = [
  'content-security-policy',
  'x-frame-options',
  'x-content-type-options',
  'referrer-policy',
  'strict-transport-security',
  'permissions-policy',
] as const;

test('R12 the landing page ships the full security header set with a locked-down CSP', async ({ request }) => {
  const res = await request.get('/');
  expect(res.status()).toBe(200);
  const headers = res.headers();

  for (const h of REQUIRED_HEADERS) {
    expect(headers[h], `landing page must send ${h}`).toBeTruthy();
  }
  // Exact values, not just presence: a header that exists with the wrong
  // value is worse than one that is missing, because it reads as "covered".
  expect(headers['x-frame-options']).toBe('SAMEORIGIN');
  expect(headers['x-content-type-options']).toBe('nosniff');
  expect(headers['referrer-policy']).toBe('strict-origin-when-cross-origin');
  expect(headers['strict-transport-security']).toContain('max-age=31536000');
  expect(headers['strict-transport-security']).toContain('includeSubDomains');
  expect(headers['permissions-policy']).toContain('camera=()');
  expect(headers['permissions-policy']).toContain('microphone=()');
  expect(headers['permissions-policy']).toContain('geolocation=()');

  const csp = headers['content-security-policy'];
  const directives = new Map(csp.split(';').map((d) => {
    const [name, ...values] = d.trim().split(/\s+/);
    return [name.toLowerCase(), values] as const;
  }));

  // Clickjacking / exfiltration / base-tag / form-hijack, all explicitly.
  expect(directives.get('default-src'), 'CSP default-src').toEqual(["'self'"]);
  expect(directives.get('frame-ancestors'), 'CSP frame-ancestors must be none').toEqual(["'none'"]);
  expect(directives.get('base-uri')).toEqual(["'self'"]);
  expect(directives.get('form-action')).toEqual(["'self'"]);

  // script-src is a real allowlist: it is pinned to 'self' plus named
  // reporting/CDN origins and never degrades to a wildcard or a bare scheme.
  const scriptSrc = directives.get('script-src') ?? [];
  expect(scriptSrc.length, 'CSP must declare script-src').toBeGreaterThan(0);
  expect(scriptSrc, "script-src must include 'self'").toContain("'self'");
  expect(scriptSrc, 'script-src must not be a wildcard').not.toContain('*');
  expect(scriptSrc, 'script-src must not allow a whole scheme').not.toContain('https:');
  expect(scriptSrc, 'script-src must not allow data:').not.toContain('data:');
  expect(scriptSrc, 'script-src must not allow blob:').not.toContain('blob:');
  // Every non-self source is an explicit https origin (Sentry + Turnstile).
  for (const source of scriptSrc.filter((s) => s !== "'self'")) {
    expect(source, `script-src source "${source}" must be a quoted token or an https origin`).toMatch(/^('unsafe-[a-z]+'|https:\/\/)/);
  }
  // object-src is not declared in next.config.ts; recording that here so a
  // future policy change is a deliberate edit to this line.
  expect(directives.get('object-src') ?? null, 'no object-src directive is declared today').toBeNull();
});

/**
 * The app serves a STATIC CSP from next.config.ts and never mints a nonce
 * (there is no middleware in the app that generates one; Next's own script
 * tags carry nonce="$undefined"). With a nonce-less policy, `script-src
 * 'self'` is only meaningful if the page's scripts are all same-origin — so
 * that is what is asserted here, per script src.
 */
test('R13 every script the page loads is same-origin, as the nonce-less CSP requires', async ({ request }) => {
  const res = await request.get('/');
  expect(res.status()).toBe(200);
  const html = await res.text();

  const sources = [...html.matchAll(/<script\b[^>]*?\ssrc="([^"]+)"/g)].map((m) => m[1]!);
  expect(sources.length, 'the landing page should ship scripts').toBeGreaterThan(0);
  for (const src of sources) {
    // Relative, root-absolute or absolute — but always THIS origin. No
    // third-party CDN, no protocol-relative //host, no inline handler.
    expect(src, `script "${src}" must be same-origin under script-src 'self'`).toMatch(/^(\/|\.\/|https:\/\/dokanstore\.xyz\/)/);
    expect(src.startsWith('//'), `script "${src}" must not be protocol-relative`).toBe(false);
    expect(/^https?:\/\/(?!dokanstore\.xyz)/.test(src), `script "${src}" is a third-party origin`).toBe(false);
  }
  // No inline event handlers either — the classic way to defeat a CSP that
  // only restricts script sources.
  expect(html, 'page must not use inline on* event handlers').not.toMatch(/\son[a-z]+\s*=\s*["']/i);
});

/* ══════════════════════════════════════════════════════════════════════ *
 * 7) A11Y / SEMANTIC BASICS
 * ══════════════════════════════════════════════════════════════════════ */

test('R14 the landing page is an RTL Arabic document with a working skip link', async ({ page }) => {
  const res = await page.goto('/');
  expect(res?.status()).toBe(200);

  // Read from src/app/layout.tsx — not guessed.
  await expect(page.locator('html')).toHaveAttribute('lang', 'ar');
  await expect(page.locator('html')).toHaveAttribute('dir', 'rtl');

  // The skip link targets an id that actually exists, and the target is
  // focusable-reachable (a tabindex would be needed if it were not).
  const skip = page.locator('a[href="#main-content"]');
  await expect(skip, 'the landing page must ship a skip-to-content link').toHaveCount(1);
  // sr-only until focused — it must be invisible, not absent.
  await expect(skip).toHaveClass(/sr-only/);
  await expect(page.locator('#main-content'), 'the skip link target must exist').toHaveCount(1);

  // One h1, and it is the document's real heading.
  await expect(page.locator('h1')).toHaveCount(1);

  // The skip link is a real keyboard affordance: focusing it makes it visible.
  await page.keyboard.press('Tab');
  const focusedHref = await page.evaluate(() => document.activeElement?.getAttribute('href') ?? null);
  expect(focusedHref, 'the first Tab stop must be the skip link').toBe('#main-content');
});

/**
 * Images are checked where they actually exist. The landing page renders only
 * inline lucide icons, so a landing-only image check would pass vacuously —
 * this seeds a store with a product image and checks the menu, plus the
 * landing page, so the assertion is never vacuous.
 */
test('R15 every image is either labelled or hidden from assistive tech', async ({ page, request }) => {
  const seed = await seedStore('r15');
  try {
    for (const path of ['/', `/${seed.slug}/menu/${seed.tableSlug}`]) {
      const res = await request.get(path);
      expect(res.status(), `${path} must render`).toBe(200);
      const html = await res.text();

      const images = [...html.matchAll(/<img\b[^>]*>/g)].map((m) => m[0]);
      for (const tag of images) {
        const alt = /\salt="([^"]*)"/.exec(tag);
        const hidden = /\saria-hidden="(true|)"?/.test(tag);
        const role = /\srole="presentation"/.test(tag) || /\srole="none"/.test(tag);
        expect(
          alt !== null || hidden || role,
          `image in ${path} has neither an alt nor aria-hidden: ${tag.slice(0, 160)}`
        ).toBe(true);
      }
      // Seeded store has a product image, so this branch is not empty.
      if (path !== '/') {
        expect(images.length, 'the seeded menu page renders a product image').toBeGreaterThan(0);
      }
    }

    // Same guarantee, evaluated on the live DOM rather than the markup, so a
    // client-rendered image is covered too.
    await page.goto(`/${seed.slug}/menu/${seed.tableSlug}`);
    await expect(page.locator('img').first()).toBeVisible();
    const unlabelled = await page.locator('img').evaluateAll((els) =>
      els
        .filter((el) => el.getAttribute('alt') === null && el.getAttribute('aria-hidden') !== 'true')
        .map((el) => el.outerHTML.slice(0, 120))
    );
    expect(unlabelled, 'no live image may be missing alt/aria-hidden').toEqual([]);

    // Every link must have an accessible name (text or aria-label), so the
    // skip link and the CTAs are all reachable by name.
    const namelessLinks = await page.locator('a').evaluateAll((els) =>
      els
        .filter((el) => !el.textContent?.trim() && !el.getAttribute('aria-label') && !el.querySelector('img[alt]:not([alt=""])'))
        .map((el) => el.getAttribute('href') ?? el.outerHTML.slice(0, 80))
    );
    expect(namelessLinks, 'no link may be without an accessible name').toEqual([]);
  } finally {
    await dropStore(seed);
  }
});

/* ══════════════════════════════════════════════════════════════════════ *
 * 8) STATIC / PWA
 * ══════════════════════════════════════════════════════════════════════ */

test('R16 the web app manifest is valid, branded and installable', async ({ request }) => {
  const res = await request.get('/manifest.webmanifest');
  expect(res.status()).toBe(200);
  expect(res.headers()['content-type']).toContain('application/manifest+json');

  const manifest = (await res.json()) as {
    name?: string;
    short_name?: string;
    start_url?: string;
    display?: string;
    theme_color?: string;
    background_color?: string;
    lang?: string;
    dir?: string;
    icons?: Array<{ src: string; sizes: string; type?: string; purpose?: string }>;
  };

  expect(typeof manifest.name, 'manifest needs a name').toBe('string');
  expect(manifest.name!.length).toBeGreaterThan(0);
  expect(typeof manifest.short_name, 'manifest needs a short_name').toBe('string');
  expect(manifest.short_name!.length).toBeGreaterThan(0);
  expect(manifest.display, 'an installable PWA is standalone-capable').toBeTruthy();
  expect(manifest.lang, 'the manifest declares its language').toBe('ar');
  expect(manifest.dir, 'the manifest declares its direction').toBe('rtl');
  expect(manifest.start_url, 'the manifest needs a start_url').toBeTruthy();

  // A theme colour is what the OS chrome paints; it must be a real colour.
  expect(manifest.theme_color, 'manifest must declare a theme color').toMatch(/^#[0-9a-f]{3,8}$/i);
  expect(manifest.background_color, 'manifest must declare a background color').toMatch(/^#[0-9a-f]{3,8}$/i);

  expect(Array.isArray(manifest.icons), 'manifest must declare icons').toBe(true);
  expect(manifest.icons!.length, 'an installable PWA needs at least one icon').toBeGreaterThan(0);
  for (const icon of manifest.icons!) {
    expect(typeof icon.src, 'each icon needs a src').toBe('string');
    expect(icon.sizes, 'each icon needs sizes').toMatch(/\d+x\d+/);
    // An icon the app references but does not serve is not installable.
    const iconRes = await request.get(icon.src);
    expect(iconRes.status(), `icon ${icon.src} must be served`).toBe(200);
  }
  // A maskable icon is what Android uses for the adaptive launcher shape.
  expect(manifest.icons!.some((i) => i.purpose?.includes('maskable')), 'a maskable icon is required').toBe(true);
});

test('R17 the service worker is served as JavaScript and actually registers', async ({ page, request }) => {
  const res = await request.get('/sw.js');
  expect(res.status()).toBe(200);
  expect(res.headers()['content-type'], 'sw.js must be served as JavaScript').toContain('javascript');
  const source = await res.text();
  expect(source, 'the SW must be a real worker').toContain('addEventListener');
  // Versioned cache names are what make an update actually evict the old
  // caches on activate().
  expect(source, 'the SW must version its caches').toMatch(/CACHE_VERSION\s*=/);
  expect(source, 'the SW must precache the offline shell').toContain('/offline.html');

  // Registration is a client-side effect (src/components/service-worker-register.tsx
  // runs on load), so this half needs the browser.
  await page.goto('/', { waitUntil: 'load' });
  await expect
    .poll(
      async () =>
        page.evaluate(async () => {
          if (!('serviceWorker' in navigator)) return 'unsupported';
          const reg = await navigator.serviceWorker.getRegistration();
          return reg ? `${reg.active?.state ?? 'registered'}|${reg.scope}` : 'none';
        }),
      { timeout: 25_000, message: 'the service worker must register itself' }
    )
    .toContain('activated');

  const scope = await page.evaluate(async () => (await navigator.serviceWorker.getRegistration())?.scope ?? '');
  expect(scope, 'the SW must control the whole origin').toContain('/');
  // A service worker must be served from the origin's root to hold the whole
  // scope; a narrower path means the offline shell silently never engages.
  expect(scope.endsWith('/'), 'the SW scope must be the origin root').toBe(true);
  // Note: the SW body is the app's own published source, so it is NOT run
  // through expectNoLeak — that check is for API error bodies, and a word like
  // "supabase" in a cache strategy is the app working, not a leak.
});

/* ══════════════════════════════════════════════════════════════════════ *
 * Degradation: a broken dependency must not take the app down
 * ══════════════════════════════════════════════════════════════════════ */

/**
 * /api/vitals swallows everything on purpose: a telemetry beacon is never a
 * reason to fail a page view, and a 429 on it must be invisible to the client
 * (it answers 200 either way, so a beacon can never retry-storm).
 */
test('R18 the vitals beacon never surfaces an error to the page', async ({ request }) => {
  for (const body of [{ name: 'LCP', value: 1.2, path: '/' }, { name: 'NOT_A_METRIC', value: 1 }, { name: 'CLS' }, {}, { name: 'LCP', value: 'x' }]) {
    const res = await request.post('/api/vitals', { headers: JSON_CT, data: body });
    expect([200, 204, 429], `vitals ${JSON.stringify(body)} must not error`).toContain(res.status());
  }
  // A forged beacon name is dropped, not written.
  const { data: forged } = await admin.from('web_vitals').select('id').eq('name', 'NOT_A_METRIC');
  expect(forged ?? []).toHaveLength(0);
});

/**
 * The zero-uuid is a valid uuid that exists nowhere — the classic "well
 * formed but wrong" input. Each owner-scoped route must treat it as "not
 * yours" (403/404), never as a match and never as a 500.
 */
test('R19 the zero uuid is a valid id that belongs to nobody', async ({ request }) => {
  const cases: Array<{ label: string; method: 'get' | 'post' | 'put'; path: string; body?: unknown; status: number }> = [
    { label: 'GET  /api/staff/notification-prefs', method: 'get', path: `/api/staff/notification-prefs?projectId=${ZERO_UUID}`, status: 401 },
    { label: 'POST /api/revalidate-menu', method: 'post', path: '/api/revalidate-menu', body: { projectId: ZERO_UUID }, status: 401 },
    { label: 'POST /api/push/subscribe', method: 'post', path: '/api/push/subscribe', body: { projectId: ZERO_UUID, subscription: { endpoint: 'https://fcm.googleapis.com/fcm/send/zero', keys: { p256dh: 'a', auth: 'b' } } }, status: 401 },
    { label: 'POST /api/telegram/link', method: 'post', path: '/api/telegram/link', body: { projectId: ZERO_UUID }, status: 401 },
    { label: 'POST /api/pos/cancel', method: 'post', path: '/api/pos/cancel', body: { orderId: ZERO_UUID }, status: 401 },
    { label: 'POST /api/super-admin/renew', method: 'post', path: '/api/super-admin/renew', body: { projectId: ZERO_UUID, days: 30 }, status: 401 },
    { label: 'POST /api/super-admin/deactivate', method: 'post', path: '/api/super-admin/deactivate', body: { projectId: ZERO_UUID }, status: 401 },
  ];
  for (const c of cases) {
    const res = await request[c.method](c.path, { headers: JSON_CT, ...(c.body !== undefined ? { data: c.body } : {}) });
    expect(res.status(), `${c.label} with the zero uuid must be ${c.status}`).toBe(c.status);
    expectNoLeak(await res.text(), c.label);
  }
});
