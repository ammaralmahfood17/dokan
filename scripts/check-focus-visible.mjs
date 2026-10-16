/**
 * Focus-indicator gate (audit F-12/F-13).
 *
 * WHY: `outline-none` on a focusable control removes the ONLY indicator that survives
 * forced-colors mode, and on this repo it did so on two money-path inputs (the orders date filter
 * and the POS quantity field) — measured: the class sets `outline-style: none`, and because a
 * Tailwind utility is unlayered it beats the global `*:focus-visible` rule at equal specificity.
 * The toggle component keeps its `focus-visible:outline-none` on purpose because it substitutes a
 * ring in the same declaration set — that is the pattern this gate accepts.
 *
 * Two properties make this worth a script rather than a rule in a doc: it is invisible on screen
 * until you tab through the exact control, and re-adding the class is a one-word edit.
 *
 * Run:  node scripts/check-focus-visible.mjs
 */
import { readdirSync, readFileSync, statSync } from 'node:fs';
import { join } from 'node:path';

const ROOT = 'src';
const offenders = [];

function walk(dir) {
  for (const entry of readdirSync(dir, { withFileTypes: true })) {
    const p = join(dir, entry.name);
    if (entry.isDirectory()) walk(p);
    else if (entry.name.endsWith('.tsx') || entry.name.endsWith('.ts')) check(p);
  }
}

function check(file) {
  const lines = readFileSync(file, 'utf8').split('\n');
  lines.forEach((line, i) => {
    if (!line.includes('outline-none')) return;
    if (line.trimStart().startsWith('//') || line.trimStart().startsWith('*')) return; // prose
    // Accepted shape: the same declaration set substitutes a ring.
    if (/focus(-visible)?:ring-/.test(line)) return;
    offenders.push(`${file}:${i + 1}  ${line.trim().slice(0, 110)}`);
  });
}

walk(ROOT);

if (offenders.length) {
  console.error('✗ focus indicator removed without a substitute:');
  for (const o of offenders) console.error(`  - ${o}`);
  console.error('  Fix: delete `outline-none`, or pair it with a focus(-visible):ring-* substitute.');
  process.exit(1);
}
console.log('ok — no focusable control drops its outline without a ring substitute');
