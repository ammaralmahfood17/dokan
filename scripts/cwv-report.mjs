#!/usr/bin/env node
/**
 * Weekly Core Web Vitals budget report — Wave 5 T3 (the audit's "future" item).
 *
 * `/api/vitals` has been writing real field data into `public.web_vitals` with no consumer, so the
 * table was a record of what happened rather than a budget. This reads the last 7 days and compares
 * the p75 against budgets, because p75 is what Core Web Vitals grades on: an average hides the
 * fourth user, and the fourth user is the one on a mid-range Android on Gulf mobile data.
 *
 *   LCP  p75 <= 2500ms  on /<slug>/menu/*   (the customer-facing menu; a scanned QR on 4G)
 *   LCP  p75 <= 1800ms  on /                (the landing page)
 *   INP  p75 <= 200ms   everywhere
 *
 * A breach exits non-zero, so a scheduled run that breaches is visibly FAILED rather than a line in
 * a log nobody opens. It reports; it does not page ("a breach opens a task, not a page").
 *
 *   node scripts/cwv-report.mjs            # last 7 days
 *   CWV_WINDOW_DAYS=30 node scripts/cwv-report.mjs
 */
import { execSync } from 'node:child_process';
import { existsSync, readFileSync } from 'node:fs';

function databaseUrl() {
  if (process.env.DATABASE_URL) return process.env.DATABASE_URL;
  if (existsSync('.env.local')) {
    const line = readFileSync('.env.local', 'utf8')
      .split('\n')
      .find((l) => l.startsWith('DATABASE_URL='));
    if (line) return line.slice('DATABASE_URL='.length).trim().replace(/^["']|["']$/g, '');
  }
  return null;
}

const url = databaseUrl();
if (!url) {
  console.error('DATABASE_URL is not set (and .env.local has no DATABASE_URL)');
  process.exit(2);
}

const days = Number(process.env.CWV_WINDOW_DAYS || 7);
if (!Number.isFinite(days) || days <= 0) {
  console.error(`CWV_WINDOW_DAYS must be a positive number, got ${process.env.CWV_WINDOW_DAYS}`);
  process.exit(2);
}

const SQL = `
  SELECT path, metric,
         round(percentile_cont(0.75) WITHIN GROUP (ORDER BY value_ms))::int AS p75_ms,
         count(*)::int AS samples
    FROM public.web_vitals
   WHERE created_at > now() - interval '${days} days'
     AND metric IN ('LCP','INP','CLS','FCP','TTFB')
   GROUP BY path, metric
  HAVING count(*) > 20
   ORDER BY metric, p75_ms DESC
   LIMIT 200;
`;

let rows;
try {
  // The SQL goes in on STDIN (`-f -`) rather than through `-c`: the query is multi-line and a
  // shell-quoted one-liner made psql read the newlines as backslash commands ("invalid command \n").
  const out = execSync(`psql ${JSON.stringify(url)} -tAF'|' -f -`, {
    input: SQL,
    encoding: 'utf8',
    stdio: ['pipe', 'pipe', 'pipe'],
  }).trim();
  rows = out
    ? out.split('\n').map((l) => {
        const [path, metric, p75_ms, samples] = l.split('|');
        return { path, metric, p75_ms: Number(p75_ms), samples: Number(samples) };
      })
    : [];
} catch (err) {
  console.error('could not read public.web_vitals:', err.stderr?.toString?.() || err.message);
  process.exit(2);
}

/** Budget in ms for a (metric, path), or null when this metric/path has no budget yet. */
function budget(metric, path) {
  if (metric === 'INP') return 200;
  if (metric !== 'LCP') return null; // CLS/FCP/TTFB are reported, not yet budgeted
  if (path === '/') return 1800;
  if (/^\/[^/]+\/menu\//.test(path)) return 2500;
  return null;
}

const breaches = [];
console.log(`Core Web Vitals — p75 over the last ${days} day(s), paths with > 20 samples\n`);
console.log('  path                              metric   p75    samples   budget   status');
console.log('  ' + '-'.repeat(80));
for (const r of rows) {
  const b = budget(r.metric, r.path);
  const breached = b !== null && r.p75_ms > b;
  if (breached) breaches.push({ ...r, budget_ms: b });
  console.log(
    `  ${r.path.padEnd(34).slice(0, 34)} ${r.metric.padEnd(7)} ${String(r.p75_ms).padStart(5)}ms ${String(r.samples).padStart(7)}   ${b === null ? '   —  ' : `${String(b).padStart(5)}ms`}   ${b === null ? '(no budget)' : breached ? 'BREACH' : 'ok'}`
  );
}

const judged = rows.filter((r) => budget(r.metric, r.path) !== null);
console.log(
  `  ${judged.length} budgeted row(s) judged, ${rows.length - judged.length} reported without a budget ` +
    `(the dashboard routes are the slowest in this list and have no agreed budget yet)`
);
if (!rows.length) {
  console.log('  (no path has more than 20 samples in the window — nothing can be judged yet)');
} else if (!judged.length) {
  console.log(
    '  NOTE: no budgeted path had > 20 samples, so a green run here means "not measured", not "fast".'
  );
}

console.log('');
if (breaches.length) {
  console.error(`${breaches.length} BUDGET BREACH(ES):`);
  for (const b of breaches) {
    console.error(`  ${b.path} ${b.metric} p75 ${b.p75_ms}ms > ${b.budget_ms}ms (${b.samples} samples)`);
  }
  process.exit(1);
}
console.log(
  judged.length
    ? 'no breaches: every judged metric is inside its budget.'
    : 'no breaches recorded — and nothing was judged, so this is not a green light (see the NOTE above).'
);
