/**
 * A size budget for what the browser downloads (frontend audit's action item 18: "a performance
 * budget in CI"). `check-critical-css.mjs` already guards the stylesheet's weight and the absence
 * of inlined font data; this one guards the JavaScript side, where the two real regressions in this
 * repo's history both landed: a 315 KB font sheet bundled into the critical path, and libraries
 * (the QR encoder) imported statically into a route that only needed them on one tap.
 *
 * WHY THESE CEILINGS: measured on the build of 2026-10-17 — 56 chunks, 2,033 KB total, largest
 * single chunk 353.9 KB, CSS 64 KB. The numbers below sit ~15-20% above that: loose enough that
 * ordinary work never trips them, tight enough that "a dependency leaked into the client" or "a
 * route stopped code-splitting" does. Raise them deliberately, in a commit that says why.
 *
 * Run AFTER `next build` (it reads .next/static).
 */
import { existsSync, readdirSync, statSync } from 'node:fs';
import { join, relative } from 'node:path';

const CHUNKS = '.next/static';
const MAX_CHUNK_KB = 450; // single JS chunk — the biggest is a framework chunk
const MAX_JS_KB = 2400; // every JS file the app can serve, summed
const MAX_CSS_KB = 200; // every stylesheet, summed (one 120 KB sheet is the per-sheet cap)

if (!existsSync(CHUNKS)) {
  console.error(`✗ ${CHUNKS} not found — run \`npm run build\` first (this check reads the output)`);
  process.exit(1);
}

const walk = (dir) => {
  const out = [];
  for (const entry of readdirSync(dir, { withFileTypes: true })) {
    const p = join(dir, entry.name);
    if (entry.isDirectory()) out.push(...walk(p));
    else if (/\.(js|css)$/.test(entry.name)) out.push({ path: p, kb: statSync(p).size / 1024 });
  }
  return out;
};

const files = walk(CHUNKS);
const js = files.filter((f) => f.path.endsWith('.js'));
const css = files.filter((f) => f.path.endsWith('.css'));

const totalJs = js.reduce((a, f) => a + f.kb, 0);
const totalCss = css.reduce((a, f) => a + f.kb, 0);
const biggest = js.reduce((a, f) => (f.kb > a.kb ? f : a), { path: '', kb: 0 });

const problems = [];
if (biggest.kb > MAX_CHUNK_KB) {
  problems.push(
    `largest JS chunk is ${biggest.kb.toFixed(1)} KB (budget ${MAX_CHUNK_KB} KB): ${relative(CHUNKS, biggest.path)}\n` +
      `      A single chunk this big usually means a library was imported statically into a route ` +
      `that only needs it on demand — load it with \`await import()\` at the point of use.`
  );
}
if (totalJs > MAX_JS_KB) {
  problems.push(`JS total is ${totalJs.toFixed(0)} KB across ${js.length} files (budget ${MAX_JS_KB} KB)`);
}
if (totalCss > MAX_CSS_KB) {
  problems.push(`CSS total is ${totalCss.toFixed(0)} KB across ${css.length} files (budget ${MAX_CSS_KB} KB)`);
}

if (problems.length) {
  console.error(`\n✗ bundle budget — ${problems.length} problem(s):\n`);
  for (const p of problems) console.error(`  • ${p}`);
  console.error('');
  process.exit(1);
}

console.log(
  `ok — ${js.length} JS chunks totalling ${totalJs.toFixed(0)} KB (largest ${biggest.kb.toFixed(1)} KB), ` +
    `CSS ${totalCss.toFixed(0)} KB in ${css.length} file(s)`
);
