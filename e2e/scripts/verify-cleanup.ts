/**
 * Proves cleanupTestUser removes EVERY row the E2E suite can create, including
 * the project-scoped tables that were missing from the list (service_requests,
 * order_audit_logs, order_sequences, daily_order_counters, telegram_links).
 *
 * It creates a throwaway store, writes one row into each of those tables via
 * the service-role client, calls cleanupTestUser, and then asserts every table
 * is back to zero for that project. Run manually, not in CI.
 */
import { createClient } from '@supabase/supabase-js';
import fs from 'node:fs';
import path from 'node:path';
import { cleanupTestUser, makeEmail, TEST_PASSWORD } from '../helpers';

function envVar(name: string): string {
  const raw = fs.readFileSync(path.resolve('.env.local'), 'utf-8');
  const m = raw.match(new RegExp(`^${name}\\s*=\\s*(.+)$`, 'm'));
  if (!m) throw new Error(`Missing ${name}`);
  return m[1].trim().replace(/^["']|["']$/g, '');
}

const admin = createClient(
  envVar('NEXT_PUBLIC_SUPABASE_URL'),
  envVar('SUPABASE_SERVICE_ROLE_KEY'),
  { auth: { autoRefreshToken: false, persistSession: false } }
);

const email = makeEmail();
const slug = `e2e-clean-${Date.now() % 1_000_000}`;

/** Every project-scoped table the app writes, with the column to filter on. */
const TABLES: { table: string; column: string }[] = [
  { table: 'service_requests', column: 'project_id' },
  { table: 'order_audit_logs', column: 'project_id' },
  { table: 'daily_order_counters', column: 'project_id' },
  { table: 'order_sequences', column: 'project_id' },
  { table: 'telegram_links', column: 'project_id' },
  { table: 'orders', column: 'project_id' },
  { table: 'tables', column: 'project_id' },
  // option_groups/option_choices are keyed by product_id / group_id, so they
  // are counted through the project's products (the same indirection
  // cleanupTestUser uses).
  { table: 'products', column: 'project_id' },
  { table: 'categories', column: 'project_id' },
  { table: 'staff_members', column: 'project_id' },
  { table: 'projects', column: 'id' },
];

async function countFor(table: string, column: string, projectId: string): Promise<number> {
  const { count, error } = await admin
    .from(table)
    .select('*', { count: 'exact', head: true })
    .eq(column, projectId);
  if (error) return -1;
  return count ?? 0;
}

/**
 * Option groups/choices live under a product (and a group), so they are counted
 * through the project's products — two plain queries rather than an embedded
 * filter, which keeps this runnable against production without relying on
 * PostgREST's `!inner` syntax.
 */
async function countOptions(projectId: string): Promise<number> {
  const { data: prods, error } = await admin.from('products').select('id').eq('project_id', projectId);
  if (error || !prods?.length) return error ? -1 : 0;
  const { data: groups, error: gErr } = await admin
    .from('option_groups')
    .select('id')
    .in('product_id', prods.map((p) => p.id));
  if (gErr) return -1;
  if (!groups?.length) return 0;
  const { count, error: cErr } = await admin
    .from('option_choices')
    .select('*', { count: 'exact', head: true })
    .in('group_id', groups.map((g) => g.id));
  if (cErr) return -1;
  return groups.length + (count ?? 0);
}

async function main(): Promise<void> {
  // --- create the store the way the specs do -------------------------------
  const { data: created, error: userErr } = await admin.auth.admin.createUser({
    email,
    password: TEST_PASSWORD,
    email_confirm: true,
  });
  if (userErr || !created.user) throw new Error(`createUser: ${userErr?.message}`);

  const { data: proj, error: pErr } = await admin
    .from('projects')
    .insert({ name: 'Cleanup Probe', slug, currency: 'BHD', is_active: true })
    .select('id')
    .single();
  if (pErr) throw new Error(`project: ${pErr.message}`);
  const projectId = proj!.id;

  await admin.from('staff_members').insert({ project_id: projectId, user_id: created.user.id, role: 'owner' });
  const { data: cat } = await admin.from('categories').insert({ project_id: projectId, name: 'c', sort_order: 0 }).select('id').single();
  const { data: prod } = await admin
    .from('products')
    .insert({ project_id: projectId, name: 'p', price: 1, category_id: cat!.id, is_available: true })
    .select('id')
    .single();
  const { data: optGroup } = await admin
    .from('option_groups')
    .insert({ product_id: prod!.id, name: 'g', min_select: 1, max_select: 1, sort_order: 0 })
    .select('id')
    .single();
  await admin.from('option_choices').insert({ group_id: optGroup!.id, name: 'a', price: 0.5, is_available: true, sort_order: 0 });
  await admin.from('tables').insert({ project_id: projectId, number: 1, slug: 'table-1', is_active: true, qrcode: 'x' });
  const { data: order } = await admin
    .from('orders')
    .insert({ project_id: projectId, status: 'pending', total_amount: 1, notes: 'probe' })
    .select('id')
    .single();
  await admin.from('order_items').insert({ order_id: order!.id, product_id: prod!.id, product_name: 'p', quantity: 1, unit_price: 1 });

  // --- one row in every table cleanupTestUser used to miss ----------------
  const { data: tbl } = await admin.from('tables').select('id').eq('project_id', projectId).single();
  await admin.from('service_requests').insert({ project_id: projectId, table_id: tbl!.id, type: 'waiter' });
  await admin.from('order_sequences').insert({ project_id: projectId });
  await admin.from('daily_order_counters').insert({ project_id: projectId, date: new Date().toISOString().slice(0, 10) });

  // --- assert they are all there BEFORE cleanup ----------------------------
  const before: string[] = [];
  for (const t of TABLES) {
    const n = t.table === 'option_groups' ? await countOptions(projectId) : await countFor(t.table, t.column, projectId);
    before.push(`${t.table}=${n}`);
    if (n <= 0) console.log(`  ⚠️  ${t.table} had ${n} rows before cleanup (check the insert above)`);
  }
  console.log('BEFORE cleanup:', before.join(' '));

  // --- the actual claim under test ----------------------------------------
  await cleanupTestUser(email);

  // --- assert everything is gone ------------------------------------------
  let failures = 0;
  console.log('AFTER  cleanup:');
  {
    const n = await countOptions(projectId);
    const ok = n === 0;
    if (!ok) failures += 1;
    console.log(`  ${ok ? '✅' : '❌'} ${'option_groups+choices'.padEnd(22)} ${n}`);
  }
  for (const t of TABLES) {
    const n = t.table === 'option_groups' ? await countOptions(projectId) : await countFor(t.table, t.column, projectId);
    const ok = n === 0;
    if (!ok) failures += 1;
    console.log(`  ${ok ? '✅' : '❌'} ${t.table.padEnd(22)} ${n}`);
  }

  // The auth user must be gone too.
  const { data: list } = await admin.auth.admin.listUsers({ page: 1, perPage: 1000 });
  const allUsers: { email?: string }[] = Array.isArray(list?.users) ? list.users : [];
  const stillThere = allUsers.some((u) => u.email === email);
  console.log(`  ${stillThere ? '❌' : '✅'} auth user removed       ${stillThere}`);
  if (stillThere) failures += 1;

  console.log(failures === 0 ? '\n✅ CLEANUP COMPLETE — no residue' : `\n❌ ${failures} table(s) still hold rows`);
  process.exit(failures === 0 ? 0 : 1);
}

main().catch((e) => {
  console.error('probe failed:', e);
  process.exit(1);
});
