#!/usr/bin/env node
// Guard for owner decision 8: a production deployment must FAIL to build rather than run without the
// required environment. Two behavioural assertions against the real validator plus one structural
// assertion that the build wrapper actually calls it - because a validator nobody runs is how this
// decision was silently unimplemented.
import { spawnSync } from 'node:child_process';
import { readFileSync } from 'node:fs';
import os from 'node:os';

const REQUIRED_ON_PROD = ['HEALTH_TOKEN', 'NEXT_PUBLIC_TURNSTILE_SITE_KEY', 'TURNSTILE_SECRET', 'REQUIRE_TABLE_TOKEN', 'ORDERS_TOKEN_TELEMETRY'];
// With SIGNUP_ENABLED=false the Turnstile pair is deliberately not required (signups are paused).
const REQUIRED_WHEN_PAUSED = ['HEALTH_TOKEN', 'REQUIRE_TABLE_TOKEN', 'ORDERS_TOKEN_TELEMETRY', 'SIGNUP_ENABLED'];
let failures = 0;

// 1. production, with those five absent -> must exit non-zero and name every one of them
const env = { ...process.env, VERCEL_ENV: 'production' };
for (const k of REQUIRED_ON_PROD) delete env[k];
// Run from a directory with no .env.local: otherwise this machine's own file supplies values and
// the assertion measures the local environment instead of the gate.
const prod = spawnSync('node', [process.cwd() + '/scripts/validate-env.mjs'], { env, encoding: 'utf8', cwd: os.tmpdir() });
const missingNamed = REQUIRED_ON_PROD.filter((k) => (prod.stdout + prod.stderr).includes(`${k} is required in production`));
const namedSignup = (prod.stdout + prod.stderr).includes('SIGNUP_ENABLED is required in production');
if (prod.status !== 0 && missingNamed.length === REQUIRED_ON_PROD.length && namedSignup) {
  console.log(`ok  production with none of the five set: exit ${prod.status}, all five + SIGNUP_ENABLED named`);
} else {
  failures++;
  console.error(`FAIL production gate: exit=${prod.status} named=${missingNamed.length}/${REQUIRED_ON_PROD.length}`);
}

// 1b. signups paused -> the Turnstile pair must NOT be required, the rest still are
const envPaused = { ...process.env, VERCEL_ENV: 'production', SIGNUP_ENABLED: 'false' };
for (const k of REQUIRED_ON_PROD) delete envPaused[k];
envPaused.SIGNUP_ENABLED = 'false';
for (const k of ['HEALTH_TOKEN', 'REQUIRE_TABLE_TOKEN', 'ORDERS_TOKEN_TELEMETRY']) envPaused[k] = 'set-for-this-check';
envPaused.HEALTH_TOKEN = 'a'.repeat(64);
const paused = spawnSync('node', ['scripts/validate-env.mjs'], { env: envPaused, encoding: 'utf8' });
const complainedAboutTurnstile = /TURNSTILE_SECRET|TURNSTILE_SITE_KEY/.test(paused.stdout + paused.stderr);
if (paused.status === 0 && !complainedAboutTurnstile) {
  console.log('ok  paused signups: Turnstile not required, the rest still enforced');
} else {
  failures++;
  console.error(`FAIL paused-signup mode: exit=${paused.status} complainedAboutTurnstile=${complainedAboutTurnstile}`);
}
// 1c. and a missing SIGNUP_ENABLED must be an error (open or paused, never implicit)
const envImplicit = { ...envPaused };
delete envImplicit.SIGNUP_ENABLED;
const implicit = spawnSync('node', ['scripts/validate-env.mjs'], { env: envImplicit, encoding: 'utf8' });
if (implicit.status !== 0 && (implicit.stdout + implicit.stderr).includes('SIGNUP_ENABLED')) {
  console.log('ok  no SIGNUP_ENABLED: an error, not an implicit mode');
} else {
  failures++;
  console.error(`FAIL SIGNUP_ENABLED must be explicit: exit=${implicit.status}`);
}

// 2. the same five present -> must exit 0
const env2 = { ...process.env, VERCEL_ENV: 'production' };
for (const k of REQUIRED_ON_PROD) env2[k] = 'set-for-this-check';
env2.SIGNUP_ENABLED = 'true';
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
