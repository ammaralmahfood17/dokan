#!/usr/bin/env node
/**
 * Guardrail — every service-role route must have a documented gate (audit T2 #1 and #3).
 *
 * The two worst findings of the backend audit were the SAME class: a public route that used
 * `createAdminClient()` (service role, RLS bypassed) and authorised the caller with something
 * guessable — a published table slug. Nothing in the build could have noticed a new one.
 *
 * This script fails CI when a route imports the service-role client without being listed
 * below. Being listed is a deliberate act with a written gate, which is exactly the review
 * step that was missing.
 *
 * It also fails on a STALE entry (a listed route that no longer exists), so the list cannot
 * rot into fiction — `api/public/bill` and `api/public/waiter` were deleted outright by owner
 * decision, and their entries were removed rather than kept "for later".
 */
import { execSync } from 'node:child_process';
import { readFileSync } from 'node:fs';

/** route key -> the gate that authorises it. Keep the reason short and true. */
const ALLOW = {
  // ── public (no session) ─────────────────────────────────────────────────────
  'api/public/order': 'table scan token required; per-(project,IP) + per-IP limits, tighter tokenless budget in the rollout window',
  'api/public/order-status': 'order uuid + tenant join; per-IP limit; returns status only',
  'api/auth/signup': 'unauthenticated by design; Turnstile (fail-closed in prod) + 3/min per email + 10/h per IP',
  'api/vitals': 'unauthenticated by design; 60/min per IP, clamped value',
  'api/telegram/webhook': 'x-telegram-bot-api-secret-token header + per-chat limit',
  'api/health': 'reads only; the detailed briefing requires the HEALTH_TOKEN bearer',
  // ── authenticated (getUser + membership re-checked at mutation time) ────────
  'api/pos/order': 'getUser() + project membership; per-user limit',
  'api/pos/cancel': 'getUser() + project membership; single status-transition RPC',
  'api/onboarding/project': 'getUser() + 3/hour per user; transactional RPC',
  'api/super-admin/archive-project': 'is_super_admin() + rate limit + super_admin_audit_log',
  'api/super-admin/confirm-user': 'is_super_admin() + rate limit + super_admin_audit_log (user.confirm)',
  'api/super-admin/create-project': 'is_super_admin() + rate limit + super_admin_audit_log',
  'api/super-admin/deactivate': 'is_super_admin() + rate limit + super_admin_audit_log',
  'api/super-admin/hard-delete-project': 'is_super_admin() + typed project name + audit log',
  'api/super-admin/record-payment': 'is_super_admin() + rate limit + idempotency key + audit log',
  'api/super-admin/renew': 'is_super_admin() + rate limit + audit log',
};

const files = execSync("git ls-files 'src/app/api/**/route.ts'").toString().trim().split('\n');
const keyOf = (f) => f.replace(/^src\/app\//, '').replace(/\/route\.ts$/, '');

const serviceRole = [];
for (const f of files) {
  if (readFileSync(f, 'utf8').includes('createAdminClient')) serviceRole.push(keyOf(f));
}

const undocumented = serviceRole.filter((k) => !ALLOW[k]);
const stale = Object.keys(ALLOW).filter((k) => !serviceRole.includes(k));

if (undocumented.length) {
  console.error(
    '::error::service-role route(s) without a documented gate:\n  - ' +
      undocumented.join('\n  - ') +
      '\nAdd each to ALLOW in scripts/check-public-write-gates.mjs WITH its gate, or stop using the service role there.'
  );
}
if (stale.length) {
  console.error(
    '::error::stale allow-list entry/entries (the route no longer uses createAdminClient or was deleted):\n  - ' +
      stale.join('\n  - ') +
      '\nRemove them so the list keeps describing reality.'
  );
}
if (undocumented.length || stale.length) process.exit(1);

console.log(
  `ok — ${files.length} route handlers checked, ${serviceRole.length} service-role routes, all with a documented gate`
);
