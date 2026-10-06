# Deploy runbook — dokan-v3 audit remediation (owner item R1)

Ordered steps, each with a command and a verification. Do not skip a verification: every step here
exists because a check found the problem it prevents. Rollback for each step is on the step.

Branch: `fix/audit-remediation-20261005` · PR #1 · migrations: `MIGRATION-MANIFEST.md`

---

## 1. Environment variables in Vercel (prod + preview)

**Required — the app fails closed in production when these are missing** (dynamic routes answer 500,
the signup route refuses to create accounts):

| variable | how to get it | note |
|---|---|---|
| `TURNSTILE_SECRET` | Cloudflare Turnstile dashboard | server-side verification; a wrong value is now reported as `misconfigured`, not as an outage |
| `NEXT_PUBLIC_TURNSTILE_SITE_KEY` | same dashboard (public half) | the widget |
| `HEALTH_TOKEN` | `openssl rand -hex 32` | detail block of `/api/health` only |
| `REQUIRE_TABLE_TOKEN` | `false` | **decision D4: stays false at deploy** |
| `ORDERS_TOKEN_TELEMETRY` | `true` | records `token_present=false` on every tokenless order |

Already set and unchanged: `DATABASE_URL`, `SUPABASE_SERVICE_ROLE_KEY`, `NEXT_PUBLIC_SUPABASE_URL`,
`NEXT_PUBLIC_SUPABASE_ANON_KEY`, `NEXT_PUBLIC_SITE_URL`, `SENTRY_*`, VAPID pair, Telegram pair.

**Not required: `IMPERSONATION_ENCRYPTION_KEY`.** The remediation took option A (no refresh token at
rest) rather than option B (encrypt the column), so there is no key to hold. If option B is ever
chosen instead, this is where its key goes.

Verify after saving: Vercel → Settings → Environment Variables shows all five for **both** Production
and Preview, then redeploy is required for them to take effect.

Rollback: remove the variables; the previous deployment keeps its own set.

## 2. Resend (or another transactional sender) configured and tested — BEFORE confirmations

1. Supabase → Authentication → **SMTP** → Resend host/port/user/password, sender on a domain with SPF
   + DKIM.
2. On a **preview** deployment, register a real inbox you control, confirm the mail arrives, click the
   link, sign in.
3. Only then move to step 3 with confirmations ON (they are already ON; this step is what makes that
   survivable).

Verify: a real confirmation email lands, and `/super-admin/users` no longer lists that account as
unconfirmed.

Rollback: none needed (mail settings are additive). If mail breaks, the super-admin confirm action in
`/super-admin/users` is the escape hatch (OPS-VERIFICATION §5).

## 3. Supabase Auth settings

Dashboard → Authentication: `jwt_expiry = 1800`, confirmations ON, minimum password length 10, captcha
(Turnstile) enabled. **Screenshot this into OPS-VERIFICATION §3** — the impersonation guard depends on
`jwt_expiry` and fails loudly (`SUPABASE_JWT_EXPIRY_TOO_LONG`) if it is longer.

Verify: sign in works; a 6-character signup password is refused with the Arabic hint.

Rollback: revert the toggles; note that `jwt_expiry` > 1800 breaks impersonation by design.

## 4. Backup / PITR snapshot before touching the schema

Supabase → Database → Backups: confirm the window, and take/confirm a snapshot immediately before
step 5. Record the timestamp.

Verify: the snapshot exists and its timestamp is BEFORE the migration step.

Rollback: restore the snapshot (this is the only true rollback for destructive DDL — which is why
step 5 carries none).

## 5. Non-destructive migrations — apply BEFORE the deploy

```bash
cd ~/dokan-v3 && supabase link --project-ref <ref>      # once
supabase db push --dry-run                              # expect exactly: 20261006150000_default_acl_hardening.sql
supabase db push                                        # applies it
```
This one only revokes platform-granted future-object privileges; it changes no data and is a no-op on
the current production state (DRIFT-REPORT §1). Do **not** let `20261006160000` or the `DEFERRED-DDL`
file into this step.

Verify: `supabase db push --dry-run` now reports nothing pending except `20261006160000`, and the P8
query in DRIFT-REPORT §3 returns 0 rows.

Rollback: re-grant with the statements in the migration's `-- ROLLBACK:` header.

## 6. Deploy

Merge PR #1 → Vercel builds and promotes. Watch the build logs for the `Typecheck · Lint · Build` job
(the same gates run in CI: `tsc`, `eslint --max-warnings 0`, `vitest`, `next build`).

Verify immediately after: `/login` 200, `/api/health` 200 with `{"status":"ok"}`, and a menu URL 200.

Rollback: Vercel → Deployments → previous deployment → **Promote**. The database is unchanged at this
point, so this is clean.

## 7. The impersonation migration — apply IMMEDIATELY AFTER the deploy

```bash
supabase db push --dry-run     # expect exactly: 20261006160000_impersonation_at_rest.sql
supabase db push
```
Why after: the OLD code writes a refresh token into `super_admin_session`, which the new CHECK refuses.
Applying it first breaks impersonation until the deploy lands. Between steps 6 and 7 impersonation is
unavailable (super-admin only) — that window is accepted and is why this step is immediate.
`NOT VALID` does not help: it spares existing rows, not new inserts (MIGRATION-MANIFEST).

Verify (all four, paste the output):
```sql
SELECT conname FROM pg_constraint WHERE conrelid='public.impersonation_sessions'::regclass AND contype='c' ORDER BY 1;
-- expect: impersonation_max_duration, impersonation_super_admin_session_no_refresh,
--         impersonation_target_session_no_refresh, impersonation_used_requires_ended
SELECT count(*) FROM information_schema.columns WHERE table_name='impersonation_sessions' AND column_name='used_at';   -- 1
```
Then start and end an impersonation as a super admin against production: it must start (the actor's
access token only), and end.

Rollback: the migration's `-- ROLLBACK:` header (drop the two constraints and `used_at`, restore the
30-minute cap). Reverting the CODE is not needed — the new code works with the old schema.

## 8. Post-deploy smoke checks

```bash
BASE_URL=https://dokanstore.xyz SMOKE_SLUG=<store> SMOKE_TABLE=table-1 \
SMOKE_TABLE_TOKEN=<the real 32-hex token> SMOKE_PRODUCT_ID=<a product uuid> \
HEALTH_TOKEN=<value> SMOKE_SUPABASE_URL=<url> SMOKE_ANON_KEY=<anon key> \
bash scripts/smoke-test.sh
```
Read-only by default; `SMOKE_ALLOW_WRITES=1` adds the two checks that create one real order (delete it
afterwards — the script prints the id). Also run it with `SMOKE_ALLOW_WRITES=1` **after** the D4 flip:
the tokenless check must then answer 403 instead of 200/201.

Verify: the script exits `0` and prints `failures: 0`.

Rollback: none — it writes nothing unless you ask it to.

## 9. Rollback plan, per failure class

| symptom | action |
|---|---|
| the site is broken after the deploy | Vercel → promote the previous deployment (step 6). The schema is unchanged up to step 6, so this fully reverts. |
| the app is up but impersonation fails | apply step 7's rollback (drop the constraints + `used_at`). The new code still works. |
| the menu serves no JSON-LD, or an old attribute | the deploy did not include the SEO commit; re-check the merge. |
| tokenless orders suddenly 403 while the flag is false | the flag was flipped early: set `REQUIRE_TABLE_TOKEN=false` in Vercel and redeploy (see POST-DEPLOY-MONITORING §rollback). |
| something is wrong and you do not know what | stop at the failing step's rollback, then run the DRIFT-REPORT §3 queries and compare against the baseline there. |
