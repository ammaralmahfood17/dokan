#!/usr/bin/env node
// Guard for owner decision 8: a production deployment must FAIL to build rather than run without the
// required environment. Two behavioural assertions against the real validator plus one structural
// assertion that the build wrapper actually calls it - because a validator nobody runs is how this
// decision was silently unimplemented.
import { spawnSync } from 'node:child_process';
import { readFileSync } from 'node:fs';

const REQUIRED_ON_PROD = ['HEALTH_TOKEN', 'NEXT_PUBLIC_TURNSTILE_SITE_KEY', 'TURNSTILE_SECRET', 'REQUIRE_TABLE_TOKEN', 'ORDERS_TOKEN_TELEMETRY'];
let failures = 0;

// 1. production, with those five absent -> must exit non-zero and name every one of them
const env = { ...process.env, VERCEL_ENV: 'production' };
for (const k of REQUIRED_ON_PROD) delete env[k];
const prod = spawnSync('node', ['scripts/validate-env.mjs'], { env, encoding: 'utf8' });
const missingNamed = REQUIRED_ON_PROD.filter((k) => (prod.stdout + prod.stderr).includes(`${k} is required in production`));
if (prod.status !== 0 && missingNamed.length === REQUIRED_ON_PROD.length) {
  console.log(`ok  production with none of the five set: exit ${prod.status}, all five named`);
} else {
  failures++;
  console.error(`FAIL production gate: exit=${prod.status} named=${missingNamed.length}/${REQUIRED_ON_PROD.length}`);
}

// 2. the same five present -> must exit 0
const env2 = { ...process.env, VERCEL_ENV: 'production' };
for (const k of REQUIRED_ON_PROD) env2[k] = 'set-for-this-check';
env2.HEALTH_TOKEN = 'a'.repeat(64);
const prodOk = spawnSync('node', ['scripts/validate-env.mjs'], { env: env2, encoding: 'utf8' });
if (prodOk.status === 0) console.log('ok  production with all five set: exit 0');
else { failures++; console.error(`FAIL production gate should pass: exit=${prodOk.status}`); }

// 3. non-production (CI has no VERCEL_ENV) -> must exit 0 even without them, or CI would break
const env3 = { ...process.env };
delete env3.VERCEL_ENV;
for (const k of REQUIRED_ON_PROD) delete env3[k];
const dev = spawnSync('node', ['scripts/validate-env.mjs'], { env: env3, encoding: 'utf8' });
if (dev.status === 0) console.log('ok  no VERCEL_ENV: exit 0 (CI is unaffected)');
else { failures++; console.error(`FAIL non-production must not enforce the production set: exit=${dev.status}`); }

// 4. structural: the build wrapper must invoke the validator for production
const wrapper = readFileSync('scripts/build-with-sentry-env.mjs', 'utf8');
if (wrapper.includes("VERCEL_ENV === 'production'") && wrapper.includes('scripts/validate-env.mjs')) {
  console.log('ok  the build wrapper gates on VERCEL_ENV and calls the validator');
} else {
  failures++;
  console.error('FAIL the build wrapper does not enforce the production environment');
}

console.log(failures === 0 ? 'PASS: the production environment gate is enforced' : `${failures} failure(s)`);
process.exit(failures === 0 ? 0 : 1);
