/**
 * Realtime cross-tenant isolation probe — audit Task 2, finding #5.
 * Amendment A7: RUN THIS BEFORE WRITING ANY ALARM CODE.
 *
 * The dashboard and the kitchen board subscribe to `orders` with NO project filter — the
 * comment in use-kitchen-orders.ts records that a filter combined with RLS made Realtime drop
 * EVERY event, so the filter was removed and the whole cross-tenant guarantee rests on
 * "Supabase Realtime honours RLS for postgres_changes". That was an untested assumption.
 * This probe tests it against a real Realtime server.
 *
 * What it does — and does NOT do:
 *   - Creates its OWN throwaway tenants (two projects + one user). It never touches the
 *     operator's existing stores, and it deletes everything it created (see `finally`).
 *   - Mirrors the app's subscription exactly: `postgres_changes` on `orders`, no filter.
 *   - Three checks:
 *       1. OWN-tenant INSERT      -> MUST arrive   (proves the channel is actually live)
 *       2. FOREIGN-tenant INSERT  -> MUST NOT arrive (the isolation claim)
 *       3. ANON subscriber        -> MUST NOT arrive (belt and braces)
 *   - Check 1 exists because a probe that never receives anything would "prove" isolation
 *     vacuously. If check 1 fails, the verdict is INCONCLUSIVE, never "isolated".
 *
 * Exit codes: 0 isolation proven · 1 LEAK (stop and report) · 2 bad args/env · 3 inconclusive.
 *
 * Usage (production, the defaults come from .env.local):
 *   node scripts/realtime-probe.ts
 * Local Supabase (empty stack — the probe makes its own fixtures):
 *   node scripts/realtime-probe.ts --url http://127.0.0.1:54321 \
 *     --anon-key <local anon> --service-key <local service_role> --timeout-ms 8000
 * Inspect the plan without touching anything:
 *   node scripts/realtime-probe.ts --dry-run
 * Leave the fixtures behind for inspection:
 *   node scripts/realtime-probe.ts --keep
 */

// @next/env is CommonJS, and how it surfaces depends on the LOADER: under Node's ESM loader the
// default import works, under tsx `import_env.default` is undefined (which is how this script died
// with "Cannot destructure property 'loadEnvConfig'"). Resolve it from whichever shape is present,
// and if neither is, do not fail - the env vars may already be exported by the caller, which is
// exactly how the CI/agent runs this script.
import * as nextEnvNs from '@next/env';
const loadEnvConfig: ((dir: string, dev?: boolean) => void) | undefined =
  (nextEnvNs as { loadEnvConfig?: (dir: string, dev?: boolean) => void }).loadEnvConfig ??
  (nextEnvNs as { default?: { loadEnvConfig?: (dir: string, dev?: boolean) => void } }).default?.loadEnvConfig;
import { createClient, type SupabaseClient } from '@supabase/supabase-js';

if (loadEnvConfig) loadEnvConfig(process.cwd(), true);

type Args = {
  url?: string;
  anonKey?: string;
  serviceKey?: string;
  timeoutMs: number;
  dryRun: boolean;
  keep: boolean;
};

function parseArgs(argv: string[]): Args {
  // Measured on production 2026-10-06: a postgres_changes event took ~18s to arrive, so an
  // 8s window reported a delivery FAILURE that was really just latency.
  const args: Args = { timeoutMs: 30000, dryRun: false, keep: false };
  for (let i = 0; i < argv.length; i++) {
    const a = argv[i];
    if (a === '--url') args.url = argv[++i];
    else if (a === '--anon-key') args.anonKey = argv[++i];
    else if (a === '--service-key') args.serviceKey = argv[++i];
    else if (a === '--timeout-ms') args.timeoutMs = Number(argv[++i]);
    else if (a === '--dry-run') args.dryRun = true;
    else if (a === '--keep') args.keep = true;
  }
  return args;
}

const sleep = (ms: number) => new Promise((r) => setTimeout(r, ms));

/** Print a line with a millisecond offset so the transcript shows real timing. */
const t0 = Date.now();
function log(msg: string) {
  console.log(`[${String(Date.now() - t0).padStart(5)}ms] ${msg}`);
}

type Check = { name: string; pass: boolean; detail: string };
const checks: Check[] = [];
function record(name: string, pass: boolean, detail: string) {
  checks.push({ name, pass, detail });
  log(`${pass ? 'PASS' : 'FAIL'}  ${name} — ${detail}`);
}

/** Wait until a Realtime channel reports SUBSCRIBED (or give up). */
async function waitForSubscribed(
  channel: { subscribe: (cb: (s: string) => void) => unknown },
  timeoutMs: number
): Promise<boolean> {
  return new Promise((resolve) => {
    const timer = setTimeout(() => resolve(false), timeoutMs);
    channel.subscribe((status: string) => {
      if (status === 'SUBSCRIBED') {
        clearTimeout(timer);
        resolve(true);
      }
      if (status === 'CHANNEL_ERROR' || status === 'TIMED_OUT') {
        clearTimeout(timer);
        resolve(false);
      }
    });
  });
}

/** Subscribe exactly the way the dashboard does: no filter, event '*'. */
function subscribeToOrders(
  client: SupabaseClient,
  channelName: string,
  seen: Set<string>,
  labels: Map<string, string>,
  arrivals: { label: string; at: number }[]
) {
  return client.channel(channelName).on(
    'postgres_changes',
    { event: '*', schema: 'public', table: 'orders' },
    (payload: { new?: Record<string, unknown> }) => {
      const id = payload.new?.id;
      if (typeof id !== 'string') return;
      seen.add(id);
      arrivals.push({ label: `${labels.get(id) ?? 'unlabelled'} ${id.slice(0, 8)}`, at: Date.now() - t0 });
    }
  );
}

async function main(): Promise<number> {
  const args = parseArgs(process.argv.slice(2));
  const url = args.url ?? process.env.NEXT_PUBLIC_SUPABASE_URL ?? '';
  const anonKey = args.anonKey ?? process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY ?? '';
  const serviceKey = args.serviceKey ?? process.env.SUPABASE_SERVICE_ROLE_KEY ?? '';

  log(`target: ${url || '(missing)'}`);
  if (!url || !anonKey || !serviceKey) {
    log('ERROR: need a URL, an anon key and a service-role key (args or .env.local).');
    return 2;
  }

  if (args.dryRun) {
    log('dry run — would: create 2 throwaway projects + 1 confirmed user, subscribe as that');
    log('  user to postgres_changes(orders) with NO filter, insert an order into its OWN');
    log('  project (must arrive), then into the OTHER project (must NOT arrive), repeat the');
    log('  foreign insert as an anonymous subscriber, then delete every fixture.');
    log('dry run — nothing was created, nothing was subscribed.');
    return 0;
  }

  const suffix = Math.random().toString(36).slice(2, 8);
  const slugA = `probe-rt-a-${suffix}`;
  const slugB = `probe-rt-b-${suffix}`;
  const email = `probe-rt-${suffix}@example.com`;
  const password = `${Math.random().toString(36).slice(2)}${Math.random().toString(36).slice(2)}Aa1`;

  const admin = createClient(url, serviceKey, {
    auth: { persistSession: false, autoRefreshToken: false },
  });

  const created = { projects: [] as string[], userId: null as string | null, orders: 0 };
  let verdict = 3;

  try {
    // ── fixtures ────────────────────────────────────────────────────────────────
    const { data: projA, error: errA } = await admin
      .from('projects')
      .insert({ name: `probe-rt-a-${suffix}`, slug: slugA, currency: 'BHD' })
      .select('id')
      .single();
    if (errA || !projA) throw new Error(`could not create probe project A: ${errA?.message}`);
    created.projects.push(projA.id);

    const { data: projB, error: errB } = await admin
      .from('projects')
      .insert({ name: `probe-rt-b-${suffix}`, slug: slugB, currency: 'BHD' })
      .select('id')
      .single();
    if (errB || !projB) throw new Error(`could not create probe project B: ${errB?.message}`);
    created.projects.push(projB.id);

    const { data: userRes, error: errU } = await admin.auth.admin.createUser({
      email,
      password,
      email_confirm: true,
    });
    if (errU || !userRes?.user) throw new Error(`could not create probe user: ${errU?.message}`);
    created.userId = userRes.user.id;

    // Membership in A only — this is what makes B "another tenant".
    const { error: errM } = await admin
      .from('staff_members')
      .insert({ project_id: projA.id, user_id: created.userId, role: 'owner' });
    if (errM) throw new Error(`could not add the probe membership: ${errM.message}`);
    log(`fixtures ready: A=${slugA} B=${slugB} (real tenants untouched)`);

    /** Insert an inert probe order. service_type keeps it out of the KDS and out of the
     *  sequential order-number counter; if a constraint rejects it we fall back and let the
     *  trigger number it (the project is throwaway and deleted below). */
    async function insertOrder(projectId: string, label: string): Promise<string> {
      let res = await admin
        .from('orders')
        .insert({ project_id: projectId, service_type: 'probe' })
        .select('id')
        .single();
      if (res.error) {
        res = await admin.from('orders').insert({ project_id: projectId }).select('id').single();
      }
      if (res.error || !res.data) throw new Error(`insert into ${label} failed: ${res.error?.message}`);
      created.orders++;
      return res.data.id as string;
    }

    // ── subscriber: an authenticated member of A (what the dashboard is) ───────
    const asUser = createClient(url, anonKey, {
      auth: { persistSession: false, autoRefreshToken: false },
    });
    const { data: signIn, error: errSignIn } = await asUser.auth.signInWithPassword({
      email,
      password,
    });
    if (errSignIn || !signIn?.session) throw new Error(`probe sign-in failed: ${errSignIn?.message}`);
    log('signed in as the probe user (member of A only)');

    const seen = new Set<string>();
    const labels = new Map<string, string>();
    const arrivals: { label: string; at: number }[] = [];
    const channel = subscribeToOrders(asUser, `probe-${projA.id}`, seen, labels, arrivals);
    const subscribed = await waitForSubscribed(channel, args.timeoutMs);
    if (!subscribed) throw new Error('channel never reached SUBSCRIBED');
    log('channel SUBSCRIBED (no filter — same as the dashboard/KDS)');
    await sleep(500); // let the server register the subscription

    // ── check 1: own tenant MUST arrive ────────────────────────────────────────
    const ownId = await insertOrder(projA.id, 'own project A');
    labels.set(ownId, 'OWN(project A)');
    await sleep(args.timeoutMs);
    record('own-tenant order arrives', seen.has(ownId), `inserted into A, event received: ${seen.has(ownId)}`);

    // ── check 2: foreign tenant MUST NOT arrive ────────────────────────────────
    const before = seen.size;
    const foreignId = await insertOrder(projB.id, 'foreign project B');
    labels.set(foreignId, 'FOREIGN(project B)');
    await sleep(args.timeoutMs);
    const leaked = seen.has(foreignId);
    record(
      'foreign-tenant order does NOT arrive',
      !leaked,
      leaked ? `LEAK: B's order ${foreignId.slice(0, 8)}… reached A's subscriber` : `no event for B (events before=${before})`
    );

    // ── check 3: an anonymous subscriber receives nothing either ───────────────
    const anon = createClient(url, anonKey, {
      auth: { persistSession: false, autoRefreshToken: false },
    });
    const anonSeen = new Set<string>();
    const anonLabels = new Map<string, string>();
    const anonArrivals: { label: string; at: number }[] = [];
    const anonChannel = subscribeToOrders(anon, `probe-anon-${suffix}`, anonSeen, anonLabels, anonArrivals);
    const anonSubscribed = await waitForSubscribed(anonChannel, args.timeoutMs);
    await sleep(500);
    const anonTarget = await insertOrder(projA.id, 'project A (anon subscriber watching)');
    anonLabels.set(anonTarget, 'ANON-TARGET(project A)');
    await sleep(args.timeoutMs);
    record(
      'anonymous subscriber receives nothing',
      anonSubscribed && !anonSeen.has(anonTarget),
      anonSubscribed ? `no event for an unauthenticated client` : 'anon channel failed to subscribe (inconclusive)'
    );

    // Delivery here is slow, so wait once more and judge on EVERYTHING that arrived, late
    // included. A late foreign row is a leak, not a rounding error.
    log(`draining a further ${args.timeoutMs}ms (late deliveries are judged too)...`);
    await sleep(args.timeoutMs);
    await asUser.removeChannel(channel);
    await anon.removeChannel(anonChannel);

    // ── verdict ────────────────────────────────────────────────────────────────
    const ownEver = seen.has(ownId);
    const foreignEver = seen.has(foreignId);
    const anonEver = anonSeen.has(anonTarget);
    log(`late-arrival audit: own=${ownEver} foreign=${foreignEver} anon=${anonEver}`);
    log(
      `  arrivals on the user channel: ${
        arrivals.map((a) => `${a.label}@${(a.at / 1000).toFixed(1)}s`).join(', ') || 'none'
      }`
    );
    log(
      `  arrivals on the anon channel: ${
        anonArrivals.map((a) => `${a.label}@${(a.at / 1000).toFixed(1)}s`).join(', ') || 'none'
      }`
    );
    // The id ledger: every id this run inserted, its role, and whether each channel saw it.
    // Without it an unexpected event shows up as "unlabelled" and cannot be attributed.
    log('  id ledger:');
    for (const [role, id] of [
      ['OWN', ownId],
      ['FOREIGN', foreignId],
      ['ANON-TARGET', anonTarget],
    ] as const) {
      log(
        `    ${role.padEnd(11)} ${id.slice(0, 8)}  user-channel=${seen.has(id)}  anon-channel=${anonSeen.has(id)}`
      );
    }

    if (foreignEver) {
      log("VERDICT: LEAK - a FOREIGN tenant's order row reached this subscriber. STOP.");
      verdict = 1;
    } else if (anonEver) {
      log('VERDICT: LEAK - an unauthenticated subscriber received an order row. STOP.');
      verdict = 1;
    } else if (!ownEver) {
      log('VERDICT: INCONCLUSIVE - the own-tenant event never arrived, even after the drain,');
      log('  so the absence of a foreign event proves nothing.');
      verdict = 3;
    } else {
      log('VERDICT: ISOLATION PROVEN - Realtime honours RLS for postgres_changes on orders.');
      if (!checks[0]?.pass) {
        log(`  (delivery was LATE: the own event missed the ${args.timeoutMs}ms window -`);
        log('   a latency note for the dashboard/KDS, not an isolation failure)');
      }
      verdict = 0;
    }
  } catch (err) {
    log(`ERROR: ${err instanceof Error ? err.message : String(err)}`);
    verdict = 2;
  } finally {
    if (args.keep) {
      log('--keep: fixtures left in place on purpose.');
    } else {
      log('cleanup…');
      if (created.projects.length) {
        await admin.from('order_items').delete().in('order_id', []); // no-op guard; items are FK-cascaded
        await admin.from('orders').delete().in('project_id', created.projects);
        await admin.from('onboarding_events').delete().in('project_id', created.projects);
        await admin.from('staff_members').delete().in('project_id', created.projects);
        await admin.from('projects').delete().in('id', created.projects);
      }
      if (created.userId) await admin.auth.admin.deleteUser(created.userId);

      const { count: leftoverProjects } = await admin
        .from('projects')
        .select('id', { count: 'exact', head: true })
        .like('slug', 'probe-rt-%');
      const { count: leftoverStaff } = await admin
        .from('staff_members')
        .select('id', { count: 'exact', head: true })
        .in('project_id', created.projects.length ? created.projects : ['00000000-0000-0000-0000-000000000000']);
      const { count: leftoverOrders } = await admin
        .from('orders')
        .select('id', { count: 'exact', head: true })
        .eq('service_type', 'probe');
      log(
        `cleanup verified: probe projects=${leftoverProjects ?? '?'} staff=${leftoverStaff ?? '?'} probe orders=${leftoverOrders ?? '?'}`
      );
      if ((leftoverProjects ?? 0) > 0 || (leftoverOrders ?? 0) > 0) {
        log('WARNING: probe rows survived cleanup — they are named probe-rt-* / service_type=probe.');
        verdict = 2;
      }
    }
  }

  log('');
  log('summary:');
  for (const c of checks) log(`  ${c.pass ? 'ok  ' : 'FAIL'} ${c.name}`);
  return verdict;
}

main()
  .then((code) => process.exit(code))
  .catch((err) => {
    console.error(err);
    process.exit(2);
  });
