/**
 * The approval gate for migrations (owner decision 2026-10-17).
 *
 * A file in `supabase/migrations/` is applied to PRODUCTION by the Supabase GitHub App on the next
 * push to `master` — so its presence there is the decision to apply it. This check makes that
 * presence deliberate: every `.sql` in that directory must be named in `APPROVED.txt`, and nothing
 * may be listed that does not exist.
 *
 * It is a tripwire against the accident (a draft committed straight into the applying directory, or
 * a file copied there instead of moved out of `supabase/pending/`), not a security boundary: the
 * two files can be edited together on purpose. The real boundary is the app's deploy-on-push
 * setting, which only the owner controls.
 */
import { execSync } from 'node:child_process';
import { existsSync, readFileSync } from 'node:fs';

const APPROVED = 'supabase/migrations/APPROVED.txt';
const problems = [];

const listed = new Set();
if (!existsSync(APPROVED)) {
  problems.push(`${APPROVED} is missing — it is the record of which migrations were approved`);
} else {
  for (const raw of readFileSync(APPROVED, 'utf8').split('\n')) {
    const line = raw.trim();
    if (!line || line.startsWith('#')) continue;
    const name = line.split(/\s+/)[0];
    if (name.endsWith('.sql')) listed.add(name);
  }
}

const files = execSync("git ls-files 'supabase/migrations/*.sql'")
  .toString()
  .trim()
  .split('\n')
  .filter(Boolean)
  .map((f) => f.replace('supabase/migrations/', ''));

const pending = existsSync('supabase/pending')
  ? execSync("git ls-files 'supabase/pending/*.sql'").toString().trim().split('\n').filter(Boolean)
  : [];
const pendingNames = new Set(pending.map((f) => f.replace('supabase/pending/', '')));

for (const f of files) {
  if (!listed.has(f)) {
    problems.push(
      `${f} — in supabase/migrations/, which the Supabase GitHub App applies to production on push, ` +
        `but not listed in ${APPROVED}. Either move it back to supabase/pending/ until it is approved, ` +
        `or, if the owner just approved it, add "${f} <YYYY-MM-DD>" to ${APPROVED} in this same commit.`
    );
  }
}

for (const name of listed) {
  if (!files.includes(name)) problems.push(`${name} — listed in ${APPROVED} but no such file in supabase/migrations/`);
}

for (const name of pendingNames) {
  if (files.includes(name)) {
    problems.push(
      `${name} — present in BOTH supabase/pending/ and supabase/migrations/. A move, not a copy: ` +
        `delete the draft from supabase/pending/ so there is one source of truth.`
    );
  }
}

if (problems.length) {
  console.error(`\n✗ migration approval gate — ${problems.length} problem(s):\n`);
  for (const p of problems) console.error(`  • ${p}`);
  console.error(
    `\nThe gate: supabase/pending/README.md\n` +
      `Why it exists: supabase/migrations/ is not a staging area — pushing it deploys it.\n`
  );
  process.exit(1);
}

console.log(
  `ok — ${files.length} migrations in supabase/migrations/ all approved` +
    `${pendingNames.size ? `, ${pendingNames.size} pending in supabase/pending/ (not applied)` : ''}`
);
