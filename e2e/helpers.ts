/**
 * E2E helpers — create/cleanup an isolated test account + store via the
 * Supabase admin client (service_role from .env.local). The signup API
 * confirms emails automatically, so a fresh user can log in immediately.
 */
import { createClient, type SupabaseClient } from '@supabase/supabase-js';
import fs from 'node:fs';
import path from 'node:path';

export const TEST_PASSWORD = 'E2e-test-123!';

/** Target environment for E2E runs. dokanstore.xyz is the canonical v3
 *  production domain (v2 was deleted 2026-09-18; the old "never point here"
 *  warning applied to v2's DB behind this domain, now gone).
 *  Override via E2E_BASE_URL. */
export const E2E_BASE_URL = (process.env.E2E_BASE_URL || 'https://dokanstore.xyz').replace(/\/$/, '');
export const E2E_HOST = new URL(E2E_BASE_URL).hostname;

function envVar(name: string): string {
  const raw = fs.readFileSync(path.resolve('.env.local'), 'utf-8');
  const m = raw.match(new RegExp(`^${name}\\s*=\\s*(.+)$`, 'm'));
  if (!m) throw new Error(`Missing ${name} in .env.local`);
  return m[1].trim().replace(/^["']|["']$/g, '');
}

const url = envVar('NEXT_PUBLIC_SUPABASE_URL');
const serviceRole = envVar('SUPABASE_SERVICE_ROLE_KEY');

/** Public Supabase URL (for direct REST/RPC calls from tests). */
export { url };

/** Service-role admin client (setup + direct assertions). */
export { admin };

/** Anon key (for authenticating a real user session in tests). */
export function anonKey(): string {
  return envVar('NEXT_PUBLIC_SUPABASE_ANON_KEY');
}

const admin: SupabaseClient = createClient(url, serviceRole, {
  auth: { autoRefreshToken: false, persistSession: false },
});

/** Unique email per run: e2e-<timestamp>-<counter>@dokan.test (counter
 *  guarantees uniqueness even for two calls in the same millisecond). */
let emailCounter = 0;
export function makeEmail(): string {
  emailCounter += 1;
  return `e2e-${Date.now()}-${emailCounter}@dokan.test`;
}

export async function createTestUser(email: string): Promise<{ id: string }> {
  const { data, error } = await admin.auth.admin.createUser({
    email,
    password: TEST_PASSWORD,
    email_confirm: true,
    user_metadata: { full_name: 'E2E Test', from_api: 'true' },
  });
  if (error || !data.user) throw new Error(`createTestUser failed: ${error?.message}`);
  return { id: data.user.id };
}

/** Supabase auth cookies for a fresh session (bypasses flaky UI login). */
export async function getAuthCookies(
  email: string,
  password: string
): Promise<{ name: string; value: string; domain: string; path: string }[]> {
  const client = createClient(url, envVar('NEXT_PUBLIC_SUPABASE_ANON_KEY'), {
    auth: { persistSession: false },
  });
  const { data, error } = await client.auth.signInWithPassword({ email, password });
  if (error || !data.session) throw new Error(`signIn failed: ${error?.message}`);
  const ref = new URL(url).hostname.split('.')[0];
  // FULL session JSON — the SSR cookie parser on production requires the
  // complete session payload (tokens-only fails with a 302 to /login).
  const sessionJson = JSON.stringify(data.session);
  return [
    { name: `sb-${ref}-auth-token`, value: sessionJson, domain: E2E_HOST, path: '/' },
  ];
}

export async function findProjectId(email: string): Promise<string | null> {
  const { data } = await admin
    .from('staff_members')
    .select('project_id')
    .eq('user_id', (await resolveUserId(email)) ?? '');
  return data?.[0]?.project_id ?? null;
}

async function resolveUserId(email: string): Promise<string | null> {
  const { data, error } = await admin.auth.admin.listUsers({ page: 1, perPage: 1000 });
  if (error) return null;
  return data.users.find((u) => u.email === email)?.id ?? null;
}

/** Full cleanup: orders → tables → products → staff → project → auth user.
 *
 *  2026-09-26: the audit found this list was missing every project-scoped table
 *  that a newer spec can create, so a failing run left real rows in PRODUCTION
 *  with nothing to ever remove them. `service_requests` is the one that matters:
 *  the public waiter/bill endpoints write it, so any test of those flows leaked
 *  a permanent row per call, and the retention sweep in 0016 does not list it
 *  either. `order_sequences` / `daily_order_counters` are created per project by
 *  the order-numbering path, so they accumulate too.
 *
 *  Deletes run children-first (order_items before orders) and the project row
 *  last, since several of these tables reference projects. Each delete is
 *  project-scoped, so cleanup can never touch a real store — the caller must
 *  pass an email that resolves to a project it created. */
export async function cleanupTestUser(email: string): Promise<void> {
  const userId = await resolveUserId(email);
  const projectId = await findProjectId(email);
  if (projectId) {
    const { data: orders } = await admin
      .from('orders')
      .select('id')
      .eq('project_id', projectId);
    for (const o of orders ?? []) {
      await admin.from('order_items').delete().eq('order_id', o.id);
    }
    await admin.from('service_requests').delete().eq('project_id', projectId);
    await admin.from('order_audit_logs').delete().eq('project_id', projectId);
    await admin.from('daily_order_counters').delete().eq('project_id', projectId);
    await admin.from('order_sequences').delete().eq('project_id', projectId);
    // impersonation_sessions is keyed by TARGET_PROJECT_ID, not project_id, and
    // it also CASCADEs from auth.users, so it is covered by the user delete
    // below. A `.eq('project_id', …)` here would throw and abort the rest.
    await admin.from('orders').delete().eq('project_id', projectId);
    await admin.from('push_subscriptions').delete().eq('project_id', projectId);
    await admin.from('subscription_payments').delete().eq('project_id', projectId);
    await admin.from('tables').delete().eq('project_id', projectId);
    // option_groups/option_choices have NO project_id (they hang off
    // product_id / group_id), and the old
    // `.eq('project_id', …)` here was a 400 that quietly did nothing. It still
    // cleaned up in the end, because option_groups.product_id is ON DELETE
    // CASCADE from products — so the line is dropped rather than "fixed": one
    // fewer misleading statement, and the cascade is the real guarantee.
    await admin.from('products').delete().eq('project_id', projectId);
    await admin.from('categories').delete().eq('project_id', projectId);
    await admin.from('staff_members').delete().eq('project_id', projectId);
    await admin.from('telegram_links').delete().eq('project_id', projectId);
    await admin.from('projects').delete().eq('id', projectId);
  }
  await admin.from('super_admins').delete().eq('user_id', userId);
  if (userId) await admin.auth.admin.deleteUser(userId);
}
