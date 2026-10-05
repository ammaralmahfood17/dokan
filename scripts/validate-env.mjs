import nextEnv from '@next/env';

const { loadEnvConfig } = nextEnv;
loadEnvConfig(process.cwd(), process.env.NODE_ENV === 'development');

const errors = [];
const warnings = [];

const required = [
  'NEXT_PUBLIC_SITE_URL',
  'NEXT_PUBLIC_SUPABASE_URL',
  'NEXT_PUBLIC_SUPABASE_ANON_KEY',
  'SUPABASE_SERVICE_ROLE_KEY',
];

for (const name of required) {
  const value = process.env[name]?.trim();
  if (!value || value.includes('<') || value.includes('...') || /placeholder/i.test(value)) {
    errors.push(`${name} is missing or still a placeholder`);
  }
}

for (const name of ['NEXT_PUBLIC_SITE_URL', 'NEXT_PUBLIC_SUPABASE_URL']) {
  const value = process.env[name];
  if (!value) continue;
  try {
    const url = new URL(value);
    if (url.protocol !== 'https:' && url.hostname !== 'localhost') {
      errors.push(`${name} must use HTTPS outside localhost`);
    }
  } catch {
    errors.push(`${name} is not a valid URL`);
  }
}

if (
  process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY &&
  process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY === process.env.SUPABASE_SERVICE_ROLE_KEY
) {
  errors.push('Supabase anon and service-role keys must be different');
}

// Owner decision 8 (2026-10-06): these must exist on a production deployment, and the boot
// must FAIL rather than run without them. Keyed on VERCEL_ENV (Vercel sets it to
// 'production'/'preview'/'development') so CI — which has neither a Turnstile key nor an ops
// token — is unaffected, while a real prod deploy that forgot them will not start.
const isProductionDeploy = process.env.VERCEL_ENV === 'production';

const productionRequired = [
  // Without it /api/health answers anyone, briefing an attacker on the deployment.
  ['HEALTH_TOKEN', 'the ops endpoints would be open to the public'],
  // Without them signup is unprotected (Turnstile) — decision 7 turned it on.
  ['NEXT_PUBLIC_TURNSTILE_SITE_KEY', 'the signup widget would not render'],
  ['TURNSTILE_SECRET', 'signup could not be verified'],
  // Security flags: a deployment that forgets them silently runs in the wrong mode.
  ['REQUIRE_TABLE_TOKEN', 'the table-token rollout mode would be implicit'],
  ['ORDERS_TOKEN_TELEMETRY', 'the rollout telemetry would be implicit'],
];

if (isProductionDeploy) {
  for (const [name, why] of productionRequired) {
    if (!process.env[name] || !process.env[name].trim()) {
      errors.push(`${name} is required in production — ${why}`);
    }
  }
  const health = process.env.HEALTH_TOKEN?.trim();
  if (health && !/^[0-9a-f]{64}$/i.test(health)) {
    // Not fatal: any long random string works. A short one does not.
    if (health.length < 32) {
      errors.push('HEALTH_TOKEN is shorter than 32 chars — use `openssl rand -hex 32`');
    }
  }
}

const pairedGroups = [
  ['push notifications', ['NEXT_PUBLIC_VAPID_PUBLIC_KEY', 'VAPID_PRIVATE_KEY']],
  ['Telegram webhook', ['TELEGRAM_BOT_TOKEN', 'TELEGRAM_WEBHOOK_SECRET']],
  ['Sentry source maps', ['SENTRY_ORG', 'SENTRY_PROJECT', 'SENTRY_AUTH_TOKEN']],
  // Half a Turnstile config is worse than none: the widget renders but the server cannot
  // verify it, so every signup would fail. Fail loudly instead.
  ['Cloudflare Turnstile (signup)', ['NEXT_PUBLIC_TURNSTILE_SITE_KEY', 'TURNSTILE_SECRET']],
];

for (const [label, names] of pairedGroups) {
  const present = names.filter((name) => process.env[name]);
  if (present.length > 0 && present.length < names.length) {
    errors.push(`${label} is partially configured (${present.length}/${names.length})`);
  } else if (present.length === 0) {
    warnings.push(`${label} is disabled`);
  }
}

if (!process.env.NEXT_PUBLIC_SENTRY_DSN && !process.env.SENTRY_DSN) {
  warnings.push('browser error monitoring is disabled');
}

for (const warning of warnings) console.warn(`[env] warning: ${warning}`);
if (errors.length) {
  for (const error of errors) console.error(`[env] error: ${error}`);
  process.exit(1);
}

console.log('[env] production environment is valid');
