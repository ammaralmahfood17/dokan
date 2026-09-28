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

const pairedGroups = [
  ['push notifications', ['NEXT_PUBLIC_VAPID_PUBLIC_KEY', 'VAPID_PRIVATE_KEY']],
  ['Telegram webhook', ['TELEGRAM_BOT_TOKEN', 'TELEGRAM_WEBHOOK_SECRET']],
  ['Sentry source maps', ['SENTRY_ORG', 'SENTRY_PROJECT', 'SENTRY_AUTH_TOKEN']],
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
