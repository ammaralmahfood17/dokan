#!/usr/bin/env node
/**
 * Guardrail — ARCHITECTURE.md must describe the app that actually exists.
 *
 * The file claimed "14 route handlers" while 28 were on disk, and named a
 * migrations file that does not exist. A document that contradicts the code is
 * worse than no document: it teaches the next reader to distrust all of it. So
 * the route table is CHECKED, not trusted:
 *
 *   1. the `<!-- routes: N -->` marker must equal the number of route files;
 *   2. every path listed in the table must exist on disk;
 *   3. every route on disk must be listed.
 *
 * Fix a failure by editing ARCHITECTURE.md — the code is the source of truth.
 */
import { execSync } from 'node:child_process';
import { readFileSync } from 'node:fs';

const DOC = 'ARCHITECTURE.md';
const doc = readFileSync(DOC, 'utf8');

/** Routes on disk, as `/api/...` (dynamic segments kept verbatim). */
const files = execSync("git ls-files 'src/app/api/**/route.ts'").toString().trim().split('\n').filter(Boolean);
const onDisk = new Set(
  files.map((f) => '/api' + f.replace(/^src\/app\/api/, '').replace(/\/route\.ts$/, ''))
);

const declaredMatch = doc.match(/<!--\s*routes:\s*(\d+)\s*-->/);
if (!declaredMatch) {
  console.error(`::error::${DOC} has no "<!-- routes: N -->" marker — the route count cannot be checked.`);
  process.exit(1);
}
const declared = Number(declaredMatch[1]);

/** Table rows that name a path: | `/api/...` | … */
const listed = new Set(
  [...doc.matchAll(/^\|\s*`(\/api\/[^`]+)`\s*\|/gm)].map((m) => m[1].replace(/\/$/, ''))
);

const missing = [...onDisk].filter((p) => !listed.has(p)).sort();
const stale = [...listed].filter((p) => !onDisk.has(p)).sort();
const problems = [];

if (declared !== onDisk.size) {
  problems.push(`the marker says ${declared} routes, the filesystem has ${onDisk.size}`);
}
if (missing.length) problems.push(`on disk but not in the table: ${missing.join(', ')}`);
if (stale.length) problems.push(`in the table but no such route: ${stale.join(', ')}`);

if (problems.length) {
  console.error(
    `::error::${DOC} disagrees with the code:\n  - ${problems.join('\n  - ')}\n` +
      'Update the route table (and the `<!-- routes: N -->` marker) to match src/app/api.'
  );
  process.exit(1);
}

console.log(`ok — ${DOC} lists all ${onDisk.size} routes, and no route that does not exist`);
