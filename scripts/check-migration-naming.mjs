#!/usr/bin/env node
/**
 * Guardrail — migration filenames stay in one, orderable convention.
 *
 * The directory holds two eras: the squashed baseline and its nineteen
 * follow-ups (`0000_init.sql` … `0019_*.sql`), and everything since
 * 2026-10-06, which is timestamp-named (`YYYYMMDDHHMMSS_name.sql`). Both sort
 * correctly, but mixing them means the next author copies whichever file they
 * happened to open, and `0001_…` collides with the legacy numbering.
 *
 * NOT renaming the legacy twenty is deliberate: they are applied on production
 * and `supabase_migrations.schema_migrations` records them BY VERSION, so a
 * rename breaks the ledger's correspondence with the repository (the CLI would
 * read them as unapplied). The unification is FORWARD-ONLY, and this script is
 * what makes that stick: any new `NNNN_`-style file fails CI.
 *
 * A number-prefixed file is therefore allowed only if it is in the list below.
 */
import { execSync } from 'node:child_process';

/** The squashed baseline + its nineteen (all applied). Do not add to this list. */
const LEGACY = [
  '0000_init.sql',
  '0001_renew_subscription_super_admin_only.sql',
  '0002_drop_handle_new_user_safety.sql',
  '0003_security_hardening_batch1.sql',
  '0004_close_anon_privilege_escalation.sql',
  '0005_harden_caller_id_pattern.sql',
  '0006_phase1_backend_hardening.sql',
  '0007_onboarding_transactional.sql',
  '0008_renew_unarchive.sql',
  '0009_purge_rate_limits.sql',
  '0010_subscription_payments.sql',
  '0011_soldout_public_read.sql',
  '0012_product_images_bucket.sql',
  '0013_close_privilege_escalation_paths.sql',
  '0014_order_idempotency.sql',
  '0015_web_vitals.sql',
  '0016_retention_sweeps.sql',
  '0017_order_integrity.sql',
  '0018_product_stock.sql',
  '0019_onboarding_events.sql',
];

const files = execSync("git ls-files 'supabase/migrations/*.sql'")
  .toString()
  .trim()
  .split('\n')
  .filter(Boolean)
  .map((f) => f.replace('supabase/migrations/', ''));

const problems = [];

for (const f of files) {
  const numeric = /^\d{4}_/.test(f);
  const timestamped = /^\d{14}_[\w.-]+\.sql$/.test(f);
  if (numeric && !LEGACY.includes(f)) {
    problems.push(`${f} — a new migration must be named YYYYMMDDHHMMSS_name.sql (numeric prefixes are legacy-only)`);
  }
  if (!numeric && !timestamped) {
    problems.push(`${f} — expected YYYYMMDDHHMMSS_name.sql`);
  }
}

// The grandfathered list must still describe reality: a deleted/renamed legacy
// file would otherwise silently widen what "legacy" means.
const presentLegacy = files.filter((f) => /^\d{4}_/.test(f));
for (const f of LEGACY) {
  if (!presentLegacy.includes(f)) {
    problems.push(`${f} — listed as legacy but not present (update LEGACY if it was renamed on purpose)`);
  }
}

const timestampedCount = files.length - presentLegacy.length;

if (problems.length) {
  console.error(
    `::error::migration filenames:\n  - ${problems.join('\n  - ')}\n` +
      'Use: supabase/migrations/YYYYMMDDHHMMSS_short_name.sql'
  );
  process.exit(1);
}

console.log(
  `ok — ${files.length} migrations checked (${presentLegacy.length} legacy numeric, ${timestampedCount} timestamped)`
);
