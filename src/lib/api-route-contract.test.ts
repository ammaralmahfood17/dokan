import { describe, expect, it } from 'vitest';
import { readFileSync, readdirSync, statSync } from 'node:fs';
import { join, resolve } from 'node:path';

/**
 * API ROUTE CONTRACT — every `/api/...` a client fetches must exist.
 *
 * Why this exists (2026-10-06): the menu's «طلب موظف» and «طلب فاتورة» buttons
 * POSTed to `/api/public/waiter` and `/api/public/bill` for days after those two
 * routes were deleted. Nothing failed: tsc, lint, the unit suite, the build and
 * CI were all green, because the only test that covered those routes was deleted
 * IN THE SAME COMMIT as the routes. The product silently lied to the customer
 * (a 404 rendered the HTML not-found page, and the client showed «تعذّر إرسال
 * الطلب»), and the owner found it — not us.
 *
 * A deleted route is invisible to a type checker: `fetch('/api/x')` is just a
 * string. This test is the missing link between the client's call sites and the
 * filesystem that answers them.
 *
 * Dynamic call sites (`fetch(`/api/public/${kind}`)`) cannot be resolved from
 * the string alone, so they are declared explicitly below with their possible
 * values. That is deliberate friction: adding a new dynamic call site forces you
 * to write down what it can hit, which is exactly the moment the next deletion
 * gets caught.
 */

const ROOT = process.cwd();
const API_DIR = resolve(ROOT, 'src/app/api');
const SRC_DIR = resolve(ROOT, 'src');

/** Dynamic call-site expressions → every path they can actually produce. */
const DYNAMIC_CALL_SITES: Record<string, string[]> = {
  // menu-client.tsx callService(kind: 'waiter' | 'bill')
  '/api/public/${kind}': ['/api/public/waiter', '/api/public/bill'],
};

function walk(dir: string, out: string[] = []): string[] {
  for (const name of readdirSync(dir)) {
    if (name === 'node_modules' || name.startsWith('.')) continue;
    const path = join(dir, name);
    if (statSync(path).isDirectory()) walk(path, out);
    else out.push(path);
  }
  return out;
}

/** Every route the app actually serves, as `/api/...` (dynamic segments kept). */
function routesOnDisk(): Set<string> {
  const routes = new Set<string>();
  for (const file of walk(API_DIR)) {
    if (!file.endsWith('route.ts')) continue;
    if (file.endsWith('route.test.ts')) continue;
    const rel = file.slice(API_DIR.length, -'/route.ts'.length);
    routes.add(`/api${rel.split('\\').join('/')}`);
  }
  return routes;
}

/** `fetch(...)` targets found in client/server code, comments excluded. */
function callSites(): { file: string; target: string }[] {
  const found: { file: string; target: string }[] = [];
  for (const file of walk(SRC_DIR)) {
    if (!/\.(ts|tsx)$/.test(file) || file.endsWith('.test.ts') || file.endsWith('.test.tsx')) continue;
    const lines = readFileSync(file, 'utf8').split('\n');
    lines.forEach((line, i) => {
      const trimmed = line.trim();
      // Skip comment lines so a documented `fetch('/api/x')` is not a false positive.
      if (trimmed.startsWith('//') || trimmed.startsWith('*') || trimmed.startsWith('/*')) return;
      for (const m of line.matchAll(/fetch\(\s*[`'"]([^`'"]+)[`'"]/g)) {
        found.push({ file: `${file.slice(ROOT.length + 1)}:${i + 1}`, target: m[1] });
      }
    });
  }
  return found;
}

describe('API route contract', () => {
  const routes = routesOnDisk();
  const sites = callSites();

  it('finds routes and call sites to compare (guards against a silent no-op test)', () => {
    expect(routes.size, 'no API routes found — the walk is broken').toBeGreaterThan(10);
    expect(sites.length, 'no fetch call sites found — the scan is broken').toBeGreaterThan(10);
  });

  it('every static fetch target resolves to a route file', () => {
    const broken = sites
      .filter((s) => s.target.startsWith('/api/') && !s.target.includes('${'))
      .filter((s) => !routes.has(s.target.split('?')[0].replace(/\/$/, '')));
    expect(
      broken.map((b) => `${b.file} → ${b.target}`),
      'these call sites fetch an /api path that has no route.ts (a deleted route?)'
    ).toEqual([]);
  });

  it('every dynamic call site is declared AND each of its paths resolves', () => {
    const undeclared = sites
      .filter((s) => s.target.includes('${') && s.target.startsWith('/api/'))
      .filter((s) => !(s.target in DYNAMIC_CALL_SITES));
    expect(
      undeclared.map((u) => `${u.file} → ${u.target}`),
      'a dynamic fetch target must be listed in DYNAMIC_CALL_SITES with its possible paths'
    ).toEqual([]);

    for (const [expr, paths] of Object.entries(DYNAMIC_CALL_SITES)) {
      for (const p of paths) {
        expect(routes.has(p), `DYNAMIC_CALL_SITES maps ${expr} to ${p}, which has no route`).toBe(true);
      }
    }
  });

  it('the two service-request routes the menu buttons need exist', () => {
    // The exact regression this whole file was written for.
    expect(routes.has('/api/public/waiter'), '«طلب موظف» button would 404').toBe(true);
    expect(routes.has('/api/public/bill'), '«طلب فاتورة» button would 404').toBe(true);
  });
});