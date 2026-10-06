#!/usr/bin/env node
/**
 * Guardrail — the build must not depend on the network (2026-10 CI follow-up).
 *
 * `next/font/google` fetches the font CSS + files from fonts.googleapis.com AT BUILD TIME. A CI
 * runner that cannot reach Google fails the entire build with
 *   "Module not found: @vercel/turbopack-next/internal/font/google/font"
 * which happened twice on this repo for identical code — a red pipeline for a reason nothing in
 * the repository controls. Cairo is self-hosted now (@fontsource-variable/cairo), and this gate
 * keeps it that way.
 *
 * Comments are stripped before matching: the explanation of the removed import names it, and a
 * naive grep would fail on its own documentation (the same trap as the design-token parsers).
 */
import { execSync } from 'node:child_process';
import { readFileSync } from 'node:fs';

const stripComments = (src) =>
  src.replace(/\/\*[\s\S]*?\*\//g, '').replace(/^[ \t]*\/\/.*$/gm, '');

const offenders = [];

const files = execSync("git ls-files 'src/**/*.ts' 'src/**/*.tsx' 'src/**/*.css' 'app/**' 'public/**'")
  .toString()
  .trim()
  .split('\n')
  .filter(Boolean);

for (const f of files) {
  let src;
  try {
    src = readFileSync(f, 'utf8');
  } catch {
    continue; // binary or unreadable (images, fonts)
  }
  const code = stripComments(src);

  if (/(?:from|require\()\s*['"]next\/font\/google['"]/.test(code)) {
    offenders.push(`${f}: imports next/font/google (fetches from Google at build time)`);
  }
  if (/fonts\.(?:googleapis|gstatic)\.com/.test(code)) {
    offenders.push(`${f}: references fonts.googleapis.com / fonts.gstatic.com`);
  }
}

if (offenders.length) {
  console.error(
    '::error::the build must not reach the network for assets:\n  - ' +
      offenders.join('\n  - ') +
      '\nSelf-host the font instead (@fontsource-variable/<family>).'
  );
  process.exit(1);
}
console.log(`ok — ${files.length} files checked, no build-time font fetch`);
