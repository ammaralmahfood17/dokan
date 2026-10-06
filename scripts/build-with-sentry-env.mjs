// Build wrapper: make the Sentry release-upload vars visible to `next build`.
//
// WHY THIS EXISTS (2026-09-26)
// withSentryConfig() uploads source maps from a CHILD process (sentry-cli) that
// `next build` spawns. Next loads .env.local for the APPLICATION, but that does
// not put SENTRY_ORG / SENTRY_PROJECT / SENTRY_AUTH_TOKEN into the environment
// of the build process's children. Locally the upload therefore silently did
// nothing: the build "succeeded" and printed no Sentry output at all, because
// the plugin was also configured with `silent: !process.env.CI` (now removed
// from next.config.ts). Vercel was never affected — there the vars are real
// process env — so this was purely a local/CI blind spot, and exactly the kind
// that hides until the one deploy you cannot reproduce.
//
// It reads .env.local WITHOUT a dependency (no dotenv in the tree), honours
// existing environment variables (CI/Vercel must win — never let a stale local
// file override a real secret), and is a no-op when the vars are absent, so it
// costs nothing on a machine that has no Sentry project.
//
// How to tell an upload actually happened (do not trust the exit code):
//   npm run build | grep "Uploaded files to Sentry"
// The build prints a full per-file report. One warning is expected and benign:
//   could not determine a source map reference for ~/0cz1d0mv5g_q7.js
// That file is Next's own nomodule polyfill, copied verbatim from
// next/dist/build/polyfills/polyfill-nomodule.js, so it has no map to upload
// and no map to lose. Everything else (~770 entries) uploads.
import { spawnSync } from 'node:child_process';
import { existsSync, readFileSync } from 'node:fs';
import { resolve } from 'node:path';

const NEEDED = ['SENTRY_ORG', 'SENTRY_PROJECT', 'SENTRY_AUTH_TOKEN'];
const envFile = resolve(process.cwd(), '.env.local');

if (existsSync(envFile)) {
  for (const rawLine of readFileSync(envFile, 'utf8').split('\n')) {
    const line = rawLine.trim();
    if (!line || line.startsWith('#')) continue;
    const eq = line.indexOf('=');
    if (eq < 1) continue;
    const key = line.slice(0, eq).trim();
    let value = line.slice(eq + 1).trim();
    if (!NEEDED.includes(key)) continue;
    if ((value.startsWith('"') && value.endsWith('"')) || (value.startsWith("'") && value.endsWith("'"))) {
      value = value.slice(1, -1);
    }
    // An already-exported value (CI, Vercel) must NOT be overwritten.
    if (process.env[key]) continue;
    if (!value) continue;
    process.env[key] = value;
  }
}

const have = NEEDED.filter((k) => process.env[k]);
if (have.length === NEEDED.length) {
  console.log(`[build] sentry upload env ready (${have.length}/${NEEDED.length} vars)`);
} else {
  // Not an error: a contributor without Sentry credentials must still build.
  console.log(
    `[build] sentry source-map upload will be skipped (missing: ${NEEDED.filter((k) => !process.env[k]).join(', ')})`,
  );
}

// Owner decision 8 (2026-10-06): "boot-time validation, fail closed in production". The validator
// existed but nothing called it on a deploy, so a misconfigured production build would ship and then
// refuse every signup at runtime (Turnstile unconfigured) instead of never shipping. It is wired
// HERE, in the build wrapper Vercel runs, and gated on VERCEL_ENV: CI sets no VERCEL_ENV and builds
// with placeholder values, so this cannot affect it.
if (process.env.VERCEL_ENV === 'production') {
  const gate = spawnSync('node', ['scripts/validate-env.mjs'], { stdio: 'inherit', env: process.env });
  if (gate.status !== 0) {
    console.error('[build] refusing to build a production deployment with an invalid environment');
    process.exit(1);
  }
}

const result = spawnSync('npx', ['next', 'build'], {
  stdio: 'inherit',
  env: process.env,
  shell: process.platform === 'win32',
});
process.exit(result.status ?? 1);
