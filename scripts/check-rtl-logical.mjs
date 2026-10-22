#!/usr/bin/env node
/**
 * RTL logical-properties gate — Wave 0 (2026-10-22).
 *
 * WHY A DIFF GATE AND NOT A TREE SWEEP: the tree predates this rule in a few
 * documented places (the printable QR sheet is a standalone HTML string, and
 * global-error.tsx must render when the stylesheet itself failed). A tree-wide
 * grep would either fail forever or need a hand-maintained allowlist of every
 * historical line. What actually regresses is a NEW line, so this gate reads
 * the diff against the base branch and judges added lines only.
 *
 * It fails on a physical directional utility or CSS property added to src/:
 *   mr-2  ml-4  pl-3  pr-1  left-0  right-4  border-l-2  text-right
 *   margin-left/right  padding-left/right  left:/right:  text-align:left|right
 *   a NEGATIVE letter-spacing (breaks Arabic joins and clips diacritics)
 *
 * Correct forms: ms-* me-* ps-* pe-* start-* end-* border-s-* text-start/end.
 *
 * Usage:
 *   node scripts/check-rtl-logical.mjs                 # base = origin/master
 *   RTL_DIFF_BASE=HEAD~3 node scripts/check-rtl-logical.mjs
 *   RTL_SELF_TEST=1 node scripts/check-rtl-logical.mjs # proves the patterns fire
 *
 * Exit codes: 0 clean, 1 violations, 2 cannot resolve a base (never a silent pass).
 */
import { execSync } from 'node:child_process';

const ALLOWLIST = new Set([
  // Standalone print document built as an HTML string: it is not laid out by
  // the app's CSS, and its page boxes are physical by definition.
  'src/app/dashboard/tables/tables-client.tsx',
  // Fallback page that must work when globals.css failed to load.
  'src/app/global-error.tsx',
]);

const CLASS_RULES = [
  {
    name: 'physical margin/padding utility',
    re: /\b(?:m[lr]|p[lr])-(?:\d|px|auto)\b/,
  },
  {
    name: 'physical inset utility',
    re: /\b(?:left|right)-(?:\d|px|auto|full|1\/2)\b/,
  },
  {
    name: 'physical border/radius utility',
    re: /\b(?:border|rounded)-[lr](?:-|\b)/,
  },
  {
    name: 'physical text alignment utility',
    re: /\btext-(?:left|right)\b/,
  },
];

const CSS_RULES = [
  {
    name: 'physical margin/padding property',
    re: /(?:margin|padding)-(?:left|right)\s*:/,
  },
  {
    name: 'physical inset property',
    re: /(?:^|[;{\s])(?:left|right)\s*:/,
  },
  {
    name: 'physical text-align',
    re: /text-align\s*:\s*(?:left|right)\b/,
  },
  {
    name: 'negative letter-spacing (Arabic joins/diacritics)',
    re: /letter-spacing\s*:\s*-/,
  },
];

const isCommentLine = (line) =>
  /^\s*(?:\/\/|\*|\/\*|<!--|#)/.test(line) || /eslint-disable/.test(line);

/** @param {string} line @param {string} file */
function violationsIn(line, file) {
  if (isCommentLine(line)) return [];
  const rules = file.endsWith('.css') ? [...CLASS_RULES, ...CSS_RULES] : CLASS_RULES;
  return rules.filter((r) => r.re.test(line)).map((r) => r.name);
}

function selfTest() {
  const cases = [
    ['className="mr-2 text-right"', 'src/x.tsx', true],
    ['className="ms-2 text-start ps-4"', 'src/x.tsx', false],
    ['margin-left: 4px;', 'src/app/globals.css', true],
    ['  letter-spacing: -0.01em;', 'src/app/globals.css', true],
    ['// mr-2 was old', 'src/x.tsx', false],
  ];
  let failed = 0;
  for (const [line, file, shouldFlag] of cases) {
    const flagged = violationsIn(line, file).length > 0;
    if (flagged !== shouldFlag) {
      console.error(`self-test FAILED: ${JSON.stringify(line)} → flagged=${flagged}, expected=${shouldFlag}`);
      failed++;
    }
  }
  if (failed) process.exit(1);
  console.log(`self-test ok — ${cases.length} cases (physical flagged, logical clean, comments ignored)`);
}

/** Pick the comparison base; never fall through to a green run. */
function resolveBase() {
  const explicit = process.env.RTL_DIFF_BASE;
  const candidates = [explicit, process.env.GITHUB_BASE_REF ? `origin/${process.env.GITHUB_BASE_REF}` : null, 'origin/master', 'HEAD~1'].filter(Boolean);
  for (const ref of candidates) {
    try {
      execSync(`git rev-parse --verify ${ref}^{commit}`, { stdio: 'ignore' });
      return ref;
    } catch {
      /* try next */
    }
  }
  return null;
}

function addedLines(base) {
  // Uncommitted work is included on purpose: a pre-commit run must catch the
  // line you are about to commit, not the previous commit.
  const diff = execSync(`git diff -U0 ${base} -- src`, {
    encoding: 'utf8',
    maxBuffer: 32 * 1024 * 1024,
  });
  const out = [];
  let file = null;
  let newLine = 0;
  for (const raw of diff.split('\n')) {
    if (raw.startsWith('+++ b/')) {
      file = raw.slice(6);
      continue;
    }
    if (raw.startsWith('@@')) {
      const m = raw.match(/\+(\d+)(?:,\d+)?/);
      newLine = m ? Number(m[1]) : 0;
      continue;
    }
    if (raw.startsWith('+') && !raw.startsWith('+++')) {
      out.push({ file, line: newLine, text: raw.slice(1) });
      newLine++;
    }
  }

  // `git diff` is blind to untracked files, which is exactly the shape of a
  // brand-new component — the most likely place for a fresh `mr-4` to land.
  const untracked = execSync('git ls-files --others --exclude-standard -- src', {
    encoding: 'utf8',
  })
    .split('\n')
    .filter(Boolean);
  for (const f of untracked) {
    let text = '';
    try {
      text = execSync(`cat ${JSON.stringify(f)}`, { encoding: 'utf8' });
    } catch {
      continue;
    }
    text.split('\n').forEach((line, i) => out.push({ file: f, line: i + 1, text: line }));
  }
  return out;
}

if (process.env.RTL_SELF_TEST === '1') {
  selfTest();
  process.exit(0);
}

const base = resolveBase();
if (!base) {
  console.error('✗ no git base found (tried RTL_DIFF_BASE, origin/$GITHUB_BASE_REF, origin/master, HEAD~1).');
  console.error('  Refusing to pass without a comparison — run with RTL_DIFF_BASE=<ref>.');
  process.exit(2);
}

const offenders = [];
for (const { file, line, text } of addedLines(base)) {
  if (!file || ALLOWLIST.has(file)) continue;
  const hits = violationsIn(text, file);
  if (hits.length) offenders.push({ file, line, text: text.trim().slice(0, 120), hits });
}

if (offenders.length === 0) {
  console.log(`ok — no physical directional CSS added since ${base} (${ALLOWLIST.size} documented allowlist entries)`);
  process.exit(0);
}

console.error(`✗ ${offenders.length} physical-direction line(s) added since ${base}:`);
for (const o of offenders) {
  console.error(`  ${o.file}:${o.line}  [${o.hits.join(', ')}]`);
  console.error(`    ${o.text}`);
}
console.error('\nUse logical properties: ms-*/me-*/ps-*/pe-*/start-*/end-*/border-s-*/text-start.');
process.exit(1);
