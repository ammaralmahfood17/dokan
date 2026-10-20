import { test, expect } from '@playwright/test';
import { createTestUser, cleanupTestUser, getAuthCookies, makeEmail, TEST_PASSWORD, admin, url, anonKey, E2E_BASE_URL, E2E_HOST } from './helpers';
import { createClient, type SupabaseClient } from '@supabase/supabase-js';

/**
 * Super Admin — Phase A verification.
 *   1. Non-super-admin user is rejected at every route (page + API).
 *   2. A super-admin can list subscriptions, renew, and deactivate.
 *   3. Every write action produces a correct audit log row (checked in DB).
 */
test.describe.configure({ mode: 'serial' });

const normalEmail = makeEmail();
const adminEmail = makeEmail();
const runId = Date.now() % 1_000_000;

let normalUserId: string;
let adminUserId: string;
let testProjectId: string;
let authedAdmin: SupabaseClient;

test.beforeAll(async () => {
  // Clean any leftovers from interrupted runs.
  await cleanupTestUser(normalEmail);
  await cleanupTestUser(adminEmail);

  const normal = await createTestUser(normalEmail);
  normalUserId = normal.id;
  const sadmin = await createTestUser(adminEmail);
  adminUserId = sadmin.id;

  // Promote the admin user to super_admin (direct seed for the test).
  await admin.from('super_admins').insert({ user_id: adminUserId });

  // A victim project owned by the normal user.
  const { data: proj } = await admin
    .from('projects')
    .insert({ name: 'SA Victim', slug: `e2e-sa-${runId}`, currency: 'BHD', primary_color: '#4338CA', is_active: true })
    .select('id')
    .single();
  testProjectId = proj!.id;
  await admin.from('staff_members').insert({ project_id: testProjectId, user_id: normalUserId, role: 'owner' });

  authedAdmin = createClient(url, anonKey(), { auth: { persistSession: false, autoRefreshToken: false } });
  const { error: se } = await authedAdmin.auth.signInWithPassword({ email: adminEmail, password: TEST_PASSWORD });
  if (se) throw new Error(`signIn failed: ${se.message}`);
});

test.afterAll(async () => {
  // Clean audit rows referencing the test project, impersonation rows,
  // then users/project.
  await admin.from('super_admin_audit_log').delete().eq('target_project_id', testProjectId);
  await admin.from('super_admin_audit_log').delete().eq('target_user_id', normalUserId);
  await admin.from('impersonation_sessions').delete().eq('super_admin_user_id', adminUserId);
  await admin.from('impersonation_sessions').delete().eq('target_user_id', normalUserId);
  await admin.from('super_admins').delete().eq('user_id', adminUserId);
  await cleanupTestUser(normalEmail);
  await cleanupTestUser(adminEmail);
});

async function authCookieHeader(): Promise<string> {
  const { data } = await authedAdmin.auth.getSession();
  const ref = new URL(url).hostname.split('.')[0];
  return `sb-${ref}-auth-token=${JSON.stringify(data.session)}`;
}

test('non-super-admin is rejected at every super-admin route', async ({ page, context }) => {
  // Page routes → NOT /super-admin (guard fires). A signed-in non-admin gets
  // bounced: /super-admin → requireSuperAdmin → /login → middleware (signed-in
  // user on auth page) → /dashboard. The invariant: never lands on /super-admin.
  const normalCookies = await getAuthCookies(normalEmail, TEST_PASSWORD);
  await context.addCookies(normalCookies);

  for (const path of ['/super-admin/subscriptions', '/super-admin/audit', '/super-admin']) {
    await page.goto(path);
    await page.waitForTimeout(2500);
    expect(page.url()).not.toContain('/super-admin');
  }
});

test('non-super-admin is rejected at every super-admin API action', async () => {
  const cookie = await authCookieHeader(); // admin's cookie — but we send as normal user below
  const { data: normalSess } = await (async () => {
    const c = createClient(url, anonKey(), { auth: { persistSession: false, autoRefreshToken: false } });
    const { data, error } = await c.auth.signInWithPassword({ email: normalEmail, password: TEST_PASSWORD });
    if (error) throw new Error(error.message);
    return { data };
  })();
  const ref = new URL(url).hostname.split('.')[0];
  const normalCookie = `sb-${ref}-auth-token=${JSON.stringify(normalSess.session)}`;
  void cookie;

  const renewRes = await fetch(`${E2E_BASE_URL}/api/super-admin/renew?projectId=${testProjectId}`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json', Cookie: normalCookie },
  });
  expect(renewRes.status).toBe(403);

  const deactRes = await fetch(`${E2E_BASE_URL}/api/super-admin/deactivate?projectId=${testProjectId}`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json', Cookie: normalCookie },
  });
  expect(deactRes.status).toBe(403);

  // No audit rows may have been written by the rejected attempts.
  const { count } = await admin
    .from('super_admin_audit_log')
    .select('id', { count: 'exact', head: true })
    .eq('target_project_id', testProjectId);
  expect(count).toBe(0);
});

test('super-admin renew + deactivate work and write audit rows', async () => {
  const cookie = await authCookieHeader();

  // --- Renew ---
  const renewRes = await fetch(`${E2E_BASE_URL}/api/super-admin/renew?projectId=${testProjectId}`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json', Cookie: cookie },
  });
  expect(renewRes.status).toBe(200);
  const { data: projAfterRenew } = await admin
    .from('projects')
    .select('subscription_expires_at')
    .eq('id', testProjectId)
    .single();
  expect(new Date(projAfterRenew?.subscription_expires_at as string).getTime()).toBeGreaterThan(Date.now());

  // --- Deactivate ---
  const deactRes = await fetch(`${E2E_BASE_URL}/api/super-admin/deactivate?projectId=${testProjectId}`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json', Cookie: cookie },
  });
  expect(deactRes.status).toBe(200);
  const { data: projAfterDeact } = await admin.from('projects').select('is_active').eq('id', testProjectId).single();
  expect(projAfterDeact?.is_active).toBe(false);

  // --- Audit rows exist with correct shape ---
  const { data: logs } = await admin
    .from('super_admin_audit_log')
    .select('action, actor_user_id, target_project_id, metadata')
    .eq('target_project_id', testProjectId)
    .order('created_at', { ascending: true });
  const actions = (logs ?? []).map((l) => l.action as string);
  expect(actions).toContain('subscription.renew');
  expect(actions).toContain('project.deactivate');

  const renewLog = (logs ?? []).find((l) => l.action === 'subscription.renew');
  expect(renewLog?.actor_user_id).toBe(adminUserId);
  expect((renewLog?.metadata as { projectName?: string })?.projectName).toBe('SA Victim');

  const deactLog = (logs ?? []).find((l) => l.action === 'project.deactivate');
  expect(deactLog?.actor_user_id).toBe(adminUserId);
  expect((deactLog?.metadata as { slug?: string })?.slug).toBe(`e2e-sa-${runId}`);
});

test('Phase B: analytics page renders for super-admin, rejected for non-admin', async ({ page, context }) => {
  // Super-admin sees the aggregate cards + per-project table.
  const adminCookies = await getAuthCookies(adminEmail, TEST_PASSWORD);
  await context.addCookies(adminCookies);
  await page.goto('/super-admin/analytics');
  await expect(page.getByRole('heading', { name: 'التحليلات' })).toBeVisible({ timeout: 20_000 });
  await expect(page.getByText('مشاريع نشطة').first()).toBeVisible();
  await expect(page.getByText(/إيرادات اليوم/).first()).toBeVisible();

  // Sortable table headers present (arrow suffix when sorted).
  await expect(page.getByText(/الإيرادات/).first()).toBeVisible();

  // Non-admin never lands on the page.
  const normalCookies = await getAuthCookies(normalEmail, TEST_PASSWORD);
  const ctx2 = await context.browser()!.newContext();
  await ctx2.addCookies(normalCookies);
  const page2 = await ctx2.newPage();
  await page2.goto('/super-admin/analytics');
  await page2.waitForTimeout(2500);
  expect(page2.url()).not.toContain('/super-admin/analytics');
  await ctx2.close();
});

test('Phase C: impersonation — start, banner, audit, end (session restored)', async ({ page, context }) => {
  // 1. Super admin starts impersonation via the API (same path the button uses).
  const adminCookies = await getAuthCookies(adminEmail, TEST_PASSWORD);
  await context.addCookies(adminCookies);
  const cookieHeader = adminCookies.map((c) => `${c.name}=${c.value}`).join('; ');

  const res = await fetch(`${E2E_BASE_URL}/api/super-admin/impersonate`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json', Cookie: cookieHeader },
    body: JSON.stringify({ targetUserId: normalUserId, projectId: testProjectId }),
  });
  const data = await res.json();
  expect(res.status, JSON.stringify(data)).toBe(200);
  expect(data.sessionId).toBeTruthy();
  // HARDENING: the target session is delivered as a Set-Cookie only — never in the body.
  expect(data.targetSession).toBeUndefined();
  expect(JSON.stringify(data)).not.toContain('access_token');

  // 2. The API already swapped the session on that response. Read the cookie it wrote (the value
  // is `base64-<base64url(JSON)>`, exactly what @supabase/ssr reads) and install it in the jar.
  const authName = `sb-${new URL(url).hostname.split('.')[0]}-auth-token`;
  const setCookies = res.headers.getSetCookie();
  const authSetCookie = setCookies.find((c) => c.startsWith(`${authName}=`));
  const markerSetCookie = setCookies.find((c) => c.startsWith('dokan-impersonation='));
  expect(authSetCookie, 'impersonate must write the SSR auth cookie').toBeTruthy();
  expect(authSetCookie).toContain('Max-Age=');
  const authValue = authSetCookie!.slice(authName.length + 1).split(';')[0];
  expect(authValue.startsWith('base64-'), 'cookie must use the @supabase/ssr encoding').toBe(true);
  const markerValue = markerSetCookie!.slice('dokan-impersonation='.length).split(';')[0];

  await context.clearCookies();
  await context.addCookies([
    { name: authName, value: authValue, domain: E2E_HOST, path: '/' },
    { name: 'dokan-impersonation', value: markerValue, domain: E2E_HOST, path: '/' },
    { name: 'dokan-support-mode', value: '1', domain: E2E_HOST, path: '/' },
  ]);

  // 3. Dashboard shows the persistent banner with the target's identity.
  await page.goto('/dashboard');
  await expect(page.getByText(/وضع الدعم الفني/).first()).toBeVisible({ timeout: 20_000 });
  await expect(page.getByText(normalEmail, { exact: false }).first()).toBeVisible();

  // 4. Audit start row exists.
  const { data: startLogs } = await admin
    .from('super_admin_audit_log')
    .select('action, actor_user_id, target_user_id')
    .eq('action', 'impersonation.start')
    .eq('target_user_id', normalUserId);
  expect((startLogs ?? []).length).toBeGreaterThan(0);

  // 5. End impersonation via the API. 2026-09-20 hardening contract: the
  // httpOnly marker cookie (set at start) is the ONLY credential — body is
  // empty, and the response must NEVER carry the admin's tokens; restoration
  // happens via Set-Cookie on this response.
  const endRes = await fetch(`${E2E_BASE_URL}/api/super-admin/impersonate/end`, {
    method: 'POST',
    headers: {
      Cookie: `${cookieHeader}; ${authName}=${authValue}; dokan-impersonation=${markerValue}; dokan-support-mode=1`,
    },
  });
  const endData = await endRes.json();
  expect(endRes.status, JSON.stringify(endData)).toBe(200);
  expect(endData.ok).toBe(true);
  expect(endData.restored, 'admin session should be restored server-side').toBe(true);
  expect(endData.superAdminSession, 'HARDENING: admin tokens must never transit the response body').toBeUndefined();
  const endSetCookies = endRes.headers.get('set-cookie') ?? '';
  expect(endSetCookies.includes('auth-token'), 'restored session must arrive via Set-Cookie').toBe(true);

  // 5b. Idempotent: a consumed marker closes support again but cannot resurrect the session.
  const endAgain = await fetch(`${E2E_BASE_URL}/api/super-admin/impersonate/end`, {
    method: 'POST',
    headers: { Cookie: `dokan-impersonation=${data.sessionId}` },
  });
  expect(endAgain.status, 'a stale marker must not error out').toBe(200);
  const again = await endAgain.json();
  expect(again.ok).toBe(true);
  expect(again.restored, 'a stale marker cannot restore an admin session').toBe(false);

  // 6. Audit end row exists.
  const { data: endLogs } = await admin
    .from('super_admin_audit_log')
    .select('action')
    .eq('action', 'impersonation.end')
    .eq('target_user_id', normalUserId);
  expect((endLogs ?? []).length).toBeGreaterThan(0);

  // 7. Row marked ended → banner no longer shows as active.
  const { data: row } = await admin.from('impersonation_sessions').select('ended_at').eq('id', data.sessionId).single();
  expect(row?.ended_at).toBeTruthy();
});

test('Phase D: create → archive (soft) → staff blocked → hard delete (name-confirmed)', async ({ page, context }) => {
  const adminCookies = await getAuthCookies(adminEmail, TEST_PASSWORD);
  const cookieHeader = adminCookies.map((c) => `${c.name}=${c.value}`).join('; ');
  const createdSlug = `e2e-d-${Date.now() % 1_000_000}`;

  // Owner must be a dedicated user with NO other project, so the archived
  // project is the one their dashboard resolves to.
  const ownerEmail = makeEmail();
  const owner = await createTestUser(ownerEmail);
  let dProjectId: string;

  try {
    // 1. Create — owner must exist.
    const badCreate = await fetch(`${E2E_BASE_URL}/api/super-admin/create-project`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json', Cookie: cookieHeader },
      body: JSON.stringify({ name: 'D Test', ownerEmail: 'nobody@dokan.test' }),
    });
    expect(badCreate.status).toBe(404);

    const createRes = await fetch(`${E2E_BASE_URL}/api/super-admin/create-project`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json', Cookie: cookieHeader },
      body: JSON.stringify({ name: 'D Test Store', ownerEmail, slug: createdSlug }),
    });
    const created = await createRes.json();
    expect(createRes.status, JSON.stringify(created)).toBe(200);
    expect(created.project?.id).toBeTruthy();
    dProjectId = created.project.id;

    // Audit create row.
    const { data: createLogs } = await admin
      .from('super_admin_audit_log')
      .select('action, metadata')
      .eq('action', 'project.create')
      .eq('target_project_id', dProjectId);
    expect((createLogs ?? []).length).toBe(1);
    expect((createLogs?.[0].metadata as { ownerEmail?: string })?.ownerEmail).toBe(ownerEmail);

    // 2. Archive — reason required.
    const noReason = await fetch(`${E2E_BASE_URL}/api/super-admin/archive-project`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json', Cookie: cookieHeader },
      body: JSON.stringify({ projectId: dProjectId }),
    });
    expect(noReason.status).toBe(400);

    const archiveRes = await fetch(`${E2E_BASE_URL}/api/super-admin/archive-project`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json', Cookie: cookieHeader },
      body: JSON.stringify({ projectId: dProjectId, reason: 'اختبار أرشفة' }),
    });
    expect(archiveRes.status).toBe(200);

    // Project soft-deleted: data retained, is_active=false, deleted_at set.
    const { data: archived } = await admin
      .from('projects')
      .select('id, is_active, deleted_at')
      .eq('id', dProjectId)
      .single();
    expect(archived?.deleted_at).toBeTruthy();
    expect(archived?.is_active).toBe(false);

    // Audit archive row with reason.
    const { data: archiveLogs } = await admin
      .from('super_admin_audit_log')
      .select('action, metadata')
      .eq('action', 'project.archive')
      .eq('target_project_id', dProjectId);
    expect((archiveLogs ?? []).length).toBe(1);
    expect((archiveLogs?.[0].metadata as { reason?: string })?.reason).toBe('اختبار أرشفة');

    // 3. Owner (staff of the archived project) → blocked at /store-unavailable.
    const ownerCookies = await getAuthCookies(ownerEmail, TEST_PASSWORD);
    const ctx2 = await context.browser()!.newContext();
    await ctx2.addCookies(ownerCookies);
    const page2 = await ctx2.newPage();
    await page2.goto('/dashboard');
    await page2.waitForURL('**/store-unavailable**', { timeout: 20_000 });
    await expect(page2.getByText('المتجر غير متاح').first()).toBeVisible();
    await ctx2.close();

    // 4. Hard delete — wrong confirm name rejected.
    const wrongName = await fetch(`${E2E_BASE_URL}/api/super-admin/hard-delete-project`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json', Cookie: cookieHeader },
      body: JSON.stringify({ projectId: dProjectId, confirmName: 'WRONG', reason: 'تنظيف' }),
    });
    expect(wrongName.status).toBe(400);

    // Correct name → deleted.
    const delRes = await fetch(`${E2E_BASE_URL}/api/super-admin/hard-delete-project`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json', Cookie: cookieHeader },
      body: JSON.stringify({ projectId: dProjectId, confirmName: 'D Test Store', reason: 'تنظيف نهائي' }),
    });
    expect(delRes.status).toBe(200);

    const { data: gone } = await admin.from('projects').select('id').eq('id', dProjectId).maybeSingle();
    expect(gone).toBeNull();

    // Audit hard-delete row with reason.
    const { data: delLogs } = await admin
      .from('super_admin_audit_log')
      .select('action, metadata')
      .eq('action', 'project.hard_delete')
      .eq('target_project_id', dProjectId);
    expect((delLogs ?? []).length).toBe(1);
    expect((delLogs?.[0].metadata as { reason?: string })?.reason).toBe('تنظيف نهائي');
  } finally {
    await cleanupTestUser(ownerEmail);
  }
});
