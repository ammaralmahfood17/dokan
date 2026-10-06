#!/usr/bin/env node
/**
 * Guardrail — icon-only buttons must be at least 44x44 (audit T1 #7, Wave 3 T6).
 *
 * The POS search "clear" and the login password "reveal" are icon-only controls on a tablet
 * surface. They shipped at h-8/w-8 and h-9/w-9 (32px and 36px), which is under the 44px touch
 * contract the rest of the product already follows — a cashier misses them mid-rush.
 *
 * This is a grep-level check on purpose: it is cheap, runs in CI, and catches the exact shape
 * that regressed. It only looks at buttons that have an aria-label and no text content
 * (i.e. icon-only), because a button with a visible label is sized by its text.
 */
import { execSync } from 'node:child_process';
import { readFileSync } from 'node:fs';

const SMALL = /\bh-(8|9|10)\b|\bw-(8|9|10)\b/;
const files = execSync("git ls-files 'src/**/*.tsx'").toString().trim().split('\n');

const offenders = [];
for (const f of files) {
  const src = readFileSync(f, 'utf8');
  const lines = src.split('\n');
  for (let i = 0; i < lines.length; i++) {
    const line = lines[i];
    if (!/aria-label=/.test(line)) continue;
    // the class attribute may be on the same line or the next few
    const window = lines.slice(i, i + 4).join(' ');
    if (!/className=/.test(window)) continue;
    if (!SMALL.test(window)) continue;
    // a control that carries a visible text label is sized by its content, not by h-8
    if (/>\s*[^<{]*[\u0600-\u06FFA-Za-z][^<{]*</.test(window)) continue;
    offenders.push(`${f}:${i + 1}`);
  }
}

if (offenders.length) {
  console.error(
    '::error::icon-only control(s) under 44px (audit T1 #7):\n  - ' +
      offenders.join('\n  - ') +
      '\nUse h-11 w-11 (44px) for an icon-only control.'
  );
  process.exit(1);
}
console.log(`ok — ${files.length} tsx files checked, no icon-only control under 44px`);
