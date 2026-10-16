/**
 * Critical-CSS budget guard.
 *
 * WHY (frontend audit F-1, 2026-10-16): the Thmanyah faces used to be a CSS `import`, so a
 * 231KB (brotli) / 315KB (raw) stylesheet — three `@font-face` rules with base64 payloads — sat
 * in front of the first paint of EVERY route. Measured with CDP throttling on the deployed build:
 * FCP 3.27s on Slow-4G and 11.1-12.8s on Slow-3G, and `PerformanceResourceTiming
 * .renderBlockingStatus` showed that sheet's arrival time WAS the FCP.
 *
 * The fix moved it to a static asset attached after first paint (public/thmanyah.css, linked with
 * media="print" + onload). A later `import '../public/thmanyah.css'` anywhere in the app would put
 * it straight back — and nothing else in the repo would fail: the build stays green, the unit
 * tests stay green, and only a throttled browser would notice. So this reads the BUILT output.
 *
 * Run after `npm run build`:  node scripts/check-critical-css.mjs
 */
import { readdirSync, readFileSync, statSync } from 'node:fs';
import { join } from 'node:path';

const CSS_DIR = '.next/static';
/** The app sheet is ~68KB raw (14KB transferred). 120KB leaves room for growth, not for a font. */
const MAX_CSS_BYTES = 120 * 1024;

function walk(dir) {
  const out = [];
  for (const entry of readdirSync(dir, { withFileTypes: true })) {
    const p = join(dir, entry.name);
    if (entry.isDirectory()) out.push(...walk(p));
    else if (entry.name.endsWith('.css')) out.push(p);
  }
  return out;
}

let files;
try {
  files = walk(CSS_DIR);
} catch {
  console.error(`✗ ${CSS_DIR} not found — run \`npm run build\` first.`);
  process.exit(1);
}

if (files.length === 0) {
  console.error(`✗ no CSS emitted under ${CSS_DIR} — the build output is not what this guard expects.`);
  process.exit(1);
}

const offenders = [];
let biggest = { file: null, bytes: 0 };

for (const file of files) {
  const source = readFileSync(file, 'utf8');
  const bytes = statSync(file).size;
  if (bytes > biggest.bytes) biggest = { file, bytes };

  if (source.includes('data:font')) {
    offenders.push(
      `${file}: contains inlined font data (${(bytes / 1024).toFixed(0)}KB) — the font sheet must ` +
        `stay OUT of the bundler (see src/app/layout.tsx and public/thmanyah.css)`
    );
  }
  if (bytes > MAX_CSS_BYTES) {
    offenders.push(
      `${file}: ${(bytes / 1024).toFixed(0)}KB exceeds the ${(MAX_CSS_BYTES / 1024).toFixed(0)}KB ` +
        `critical-CSS budget`
    );
  }
}

if (offenders.length) {
  console.error('✗ critical CSS budget violated:');
  for (const o of offenders) console.error(`  - ${o}`);
  process.exit(1);
}

console.log(
  `ok — ${files.length} stylesheets checked, largest ${(biggest.bytes / 1024).toFixed(0)}KB ` +
    `(${biggest.file}), no inlined font data`
);
