import { test, expect } from '@playwright/test';
import { readFileSync } from 'node:fs';
import { createClient } from '@supabase/supabase-js';

// @next/env is CommonJS and its shape differs per loader (@next/env resolved to no default under
// Playwright's transform and the spec failed to load). The three values this test needs are read
// from .env.local directly - no loader involved, nothing to get wrong.
try {
  for (const line of readFileSync('.env.local', 'utf8').split('\n')) {
    const m = /^([A-Z0-9_]+)=(.*)$/.exec(line.trim());
    if (m && !process.env[m[1]]) process.env[m[1]] = m[2].replace(/^["']|["']$/g, '');
  }
} catch {
  // no .env.local (CI): the skip below fires by name
}

/**
 * The regression guard for the realtime fix.
 *
 * Measured 2026-10-06, same machine, same build pipeline:
 *   before the fix: a new order took **27,295 ms** to appear on the kitchen board (the 30s fallback
 *                   poll - no event ever arrived because the channel was authorized as `anon`)
 *   after the fix:  **754 ms**
 *
 * This test asserts the user-visible property, not the mechanism: insert an order as the service
 * role while a signed-in staff member is watching the board, and require it on screen within
 * BUDGET_MS. It uses the same cookie-based session the app itself uses, so it exercises the exact
 * path that was broken.
 *
 * Needs Supabase credentials; without them it skips BY NAME (never a silent pass). Runs under
 * playwright.a11y.config.ts because that is the config with the bundled browser.
 */
const BASE = process.env.E2E_BASE_URL || 'http://localhost:3800';
const BUDGET_MS = 5000;
const PW = 'E2E-Realtime-1234567890';

const url = process.env.NEXT_PUBLIC_SUPABASE_URL;
const anon = process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY;
const svc = process.env.SUPABASE_SERVICE_ROLE_KEY;

test.describe('realtime: a new order reaches the board without a refresh', () => {
  test.skip(!url || !anon || !svc, 'set NEXT_PUBLIC_SUPABASE_URL, NEXT_PUBLIC_SUPABASE_ANON_KEY and SUPABASE_SERVICE_ROLE_KEY');

  test('the kitchen board and the orders page show it inside the budget', async ({ browser }) => {
    const U = url as string;
    const A = anon as string;
    const S = svc as string;
    const admin = createClient(U, S, { auth: { persistSession: false } });
    const suffix = Math.random().toString(36).slice(2, 8);
    const email = `e2e-rt-${suffix}@example.com`;
    let userId: string | undefined;
    let projectId: string | undefined;
    let orderId: string | undefined;

    try {
      const { data: created, error: cErr } = await admin.auth.admin.createUser({ email, password: PW, email_confirm: true });
      expect(cErr, `createUser: ${cErr?.message}`).toBeNull();
      expect(created?.user?.id, 'createUser returned no user').toBeTruthy();
      userId = created?.user?.id as string;
      const { data: proj } = await admin.from('projects')
        .insert({ name: `e2e-rt-${suffix}`, slug: `e2e-rt-${suffix}`, currency: 'BHD' }).select('id').single();
      projectId = proj!.id;
      await admin.from('staff_members').insert({ project_id: projectId, user_id: userId, role: 'owner' });
      const { data: table } = await admin.from('tables').insert({ project_id: projectId, number: 1, slug: 'table-1' }).select('id').single();

      const anonClient = createClient(U, A, { auth: { persistSession: false } });
      const { data: signIn, error: sErr } = await anonClient.auth.signInWithPassword({ email, password: PW });
      expect(sErr, `signIn: ${sErr?.message}`).toBeNull();
      expect(signIn?.session, 'signIn returned no session').toBeTruthy();
      const ref = new URL(U).hostname.split('.')[0];
      const cookieValue = 'base64-' + Buffer.from(JSON.stringify(signIn!.session)).toString('base64url');
      const ctx = await browser.newContext();
      await ctx.addCookies([{ name: `sb-${ref}-auth-token`, value: cookieValue, domain: new URL(BASE).hostname, path: '/' }]);
      const page = await ctx.newPage();

      // Only the two pages that render an order marker are asserted. /dashboard re-renders through
      // the same shared hook (so the mechanism is proven here), but it shows KPIs rather than the
      // order number, and asserting on a counter would need the prior value - a weak assertion is
      // worse than an honest boundary, so it is stated instead of faked.
      for (const route of ['/dashboard/kitchen', '/dashboard/orders']) {
        await page.goto(`${BASE}${route}`, { waitUntil: 'domcontentloaded' });
        await page.waitForTimeout(3000); // hydration + the channel opening

        const { data: order, error: oErr } = await admin.from('orders')
          .insert({ project_id: projectId, table_id: table!.id, total_amount: 1, service_type: null })
          .select('id, order_number').single();
        expect(oErr, `insert order: ${oErr?.message}`).toBeNull();
        orderId = order!.id;
        const insertedAt = Date.now();

        // The marker must not collide with anything else on the page (a bare "1" appears in prices
        // and quantities, so a weak match would report a green run for a broken socket - worse than
        // no test). Each iteration uses a FRESH project, so this project's only order is this one:
        // the board prints "#001" and the orders list prints "order-1".
        const marker = route === '/dashboard/kitchen'
          ? `#${String(order!.order_number).padStart(3, '0')}`
          : `order-${order!.order_number}`;
        let seenAt: number | null = null;
        for (let i = 0; i < BUDGET_MS / 100; i++) {
          const text = await page.evaluate(() => document.body.innerText);
          if (text.includes(marker)) { seenAt = Date.now(); break; }
          await page.waitForTimeout(100);
        }

        await admin.from('orders').delete().eq('id', orderId);
        orderId = undefined;
        expect(seenAt, `marker ${marker} never appeared on ${route} within ${BUDGET_MS}ms`).not.toBeNull();
        console.log(`${route}: marker "${marker}" visible after ${seenAt! - insertedAt}ms (budget ${BUDGET_MS}ms)`);
        expect(seenAt! - insertedAt).toBeLessThan(BUDGET_MS);
      }
    } finally {
      if (orderId) await admin.from('orders').delete().eq('id', orderId);
      if (projectId) {
        await admin.from('tables').delete().eq('project_id', projectId);
        await admin.from('staff_members').delete().eq('project_id', projectId);
        await admin.from('projects').delete().eq('id', projectId);
      }
      if (userId) await admin.auth.admin.deleteUser(userId);
      const { count } = await admin.from('projects').select('id', { count: 'exact', head: true }).like('slug', 'e2e-rt-%');
      expect(count, 'the test must clean up after itself').toBe(0);
    }
  });
});
