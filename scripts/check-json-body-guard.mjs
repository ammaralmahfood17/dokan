#!/usr/bin/env node
/**
 * Guardrail — every `request.json()` on a route must tolerate a malformed body.
 *
 * `await request.json()` THROWS on a non-JSON body (and on an empty one). Ten routes read the
 * body that way, so a caller sending junk got a 500 plus a Sentry event: on the public order
 * path that was an anonymous caller filling the error budget, and behind a session it is still
 * a self-inflicted 500 for input nobody validated. The repo's verified shape is
 * `await request.json().catch(() => null)` followed by an object check, which is what
 * `src/app/api/public/order/route.ts` shipped in W1.
 *
 * 2026-10-13 (architecture review, P1): the super-admin routes now take their body from
 * `readJsonBody()` in `src/lib/api/handler.ts`. That does not retire this rule — it moves the
 * proof — so the check now accepts TWO shapes and refuses everything else:
 *   a) the inline `await request.json().catch(...)`, or
 *   b) `readJsonBody(request, …)`, whose implementation is itself checked below, so the
 *      tolerated shape cannot be deleted from the helper without failing here.
 *
 * Comments are stripped first: the explanation of this very rule contains the bare call, and a
 * naive grep failed on its own documentation before (the design-token parsers taught that).
 */
import { execSync } from 'node:child_process';
import { readFileSync } from 'node:fs';

const HELPER = 'src/lib/api/handler.ts';

const stripComments = (src) =>
  src.replace(/\/\*[\s\S]*?\*\//g, '').replace(/^[ \t]*\/\/.*$/gm, '');

const files = execSync("git ls-files 'src/app/api/**/route.ts'").toString().trim().split('\n').filter(Boolean);
const offenders = [];
let viaHelper = 0;

for (const f of files) {
  const code = stripComments(readFileSync(f, 'utf8'));
  const lines = code.split('\n');
  lines.forEach((line, i) => {
    for (const m of line.matchAll(/await\s+request\.json\(\)/g)) {
      const after = line.slice(m.index + m[0].length);
      if (/^\s*\.catch\(/.test(after)) continue; // tolerated: the verified inline shape
      offenders.push(`${f}:${i + 1} — await request.json() with no .catch()`);
    }
  });
  if (/readJsonBody\(\s*request/.test(code)) viaHelper += 1;
}

// The helper is only a valid substitute while its own read tolerates junk.
const helperCode = stripComments(readFileSync(HELPER, 'utf8'));
if (/await\s+request\.json\(\)/.test(helperCode) && !/await\s+request\.json\(\)\s*\.catch\(/.test(helperCode)) {
  offenders.push(`${HELPER} — readJsonBody lost its .catch(() => null)`);
}
if (viaHelper > 0 && !/export\s+async\s+function\s+readJsonBody/.test(helperCode)) {
  offenders.push(`${HELPER} — routes call readJsonBody but the helper is gone`);
}

if (offenders.length) {
  console.error(
    '::error::route bodies must tolerate malformed JSON (a non-JSON body is a 400, not a 500):\n  - ' +
      offenders.join('\n  - ') +
      '\nUse: (await request.json().catch(() => null)) then reject a non-object body with 400, ' +
      'or readJsonBody(request) from @/lib/api/handler.'
  );
  process.exit(1);
}
console.log(
  `ok — ${files.length} route files checked (${viaHelper} via readJsonBody), every request.json() tolerates junk`
);
