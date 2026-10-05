# OPS-VERIFICATION — 2026-10 audit remediation

Everything in here is work **a human must do**; none of it can be done from the agent's
sandbox. Each item states the exact command/value and how to tell it worked.

Branch: `fix/audit-remediation-20261005` · base `5188588` (master)

---

## 1. Run the database gates (BLOCKED in this environment)

`npm run test:db` (supabase start + db reset + `supabase test db`) cannot run on the agent
host: `ammar` is not in the `docker` group, `/var/run/docker.sock` is `root:docker`, and
`sudo` requires a password that must never be typed into a chat.

**Do one of these — (a) is the permanent fix:**

```bash
# (a) grant docker access, then the agent can run it itself from the next session on
sudo usermod -aG docker ammar        # then log out / back in
npm run test:db                      # expect: all pgTAP plans OK

# (b) run it yourself and keep the output
cd ~/dokan-v3 && npm run test:db 2>&1 | tee /tmp/test-db.log

# (c) let CI do it — the PR runs exactly this on a clean database
#     .github/workflows/ci.yml → job `database-security` (supabase start + db reset + test db)
```

**Success looks like:** the pgTAP suites report `ok`/`plan(n)` with zero `not ok`, including
`supabase/tests/phase6_table_token.sql` (6 assertions on `resolve_table_by_token`).

**Why it matters:** this is the only gate that exercises the new SQL against a fresh,
empty database. Every other gate passes on this host.

---

## 2. Vercel environment variables (owner decision 8)

All five must exist for **Production and Preview** before the branch is deployed. Missing
ones now fail the boot (`scripts/validate-env.mjs` exits 1 when `VERCEL_ENV=production`).

| Variable | Value | Notes |
| --- | --- | --- |
| `HEALTH_TOKEN` | `openssl rand -hex 32` | Without it `/api/health` and `/api/vitals` answer anyone. |
| `NEXT_PUBLIC_TURNSTILE_SITE_KEY` | Turnstile dashboard → site key | Public; inlined into the client bundle. |
| `TURNSTILE_SECRET` | Turnstile dashboard → secret key | Server-only. Wrong value = signup refuses everything. |
| `REQUIRE_TABLE_TOKEN` | `false` | Keep `false` until item 4's condition is met. |
| `ORDERS_TOKEN_TELEMETRY` | `true` | Records `token_present` on every public order. |

Generate the ops token:

```bash
openssl rand -hex 32        # paste the 64-char result as HEALTH_TOKEN
```

Verify from a shell (any deployment):

```bash
curl -s -o /dev/null -w '%{http_code}\n' https://dokanstore.xyz/api/health              # expect 401
curl -s -o /dev/null -w '%{http_code}\n' -H "x-health-token: $HEALTH_TOKEN" \
  https://dokanstore.xyz/api/health                                                    # expect 200
```

---

## 3. Hosted Supabase Auth settings (owner decision 7)

`supabase/config.toml` only governs the LOCAL stack. Production is configured in the hosted
project, and the owner verifies it there **before** the signup changes ship.

Dashboard → Authentication → Settings:

- [ ] **Confirm email: ON** (the signup route creates users with `email_confirm: false`)
- [ ] **Minimum password length: 10**
- [ ] **JWT expiry: 1800** (seconds)

Screenshot slot (paste the dashboard capture here):

```
┌──────────────────────────────────────────────┐
│  [ Authentication settings screenshot ]      │
│  must show: confirm email ON                 │
│             min password length 10           │
│             jwt expiry 1800s                 │
└──────────────────────────────────────────────┘
```

**Also required for confirmation mail to arrive:** an SMTP provider configured under
Authentication → SMTP (the built-in sender is heavily rate-limited and often lands in spam).
A merchant who never receives the mail cannot log in at all — this is now a hard dependency
of signup.

---

## 4. QR reprint, then flip enforcement (owner decision 1)

Two steps, in order. **Step 2 is the only way to close the original Critical.**

**Step 1 — reprint.** Merchant opens `/dashboard/tables` and presses **طباعة QR**. The new
sheets embed `?k=<128-bit token>`; the banner disappears once they print or dismiss it
(`projects.qr_reprinted_at`).

**Step 2 — flip, once tokenless orders have been zero for 48h.** Check with:

```bash
# needs DATABASE_URL exported; read-only
psql "$DATABASE_URL" -At -c "
  select date_trunc('hour', created_at) as hour,
         count(*) filter (where (metadata->>'token_present')::boolean is false) as tokenless,
         count(*) as total
  from public.order_audit_logs
  where created_at > now() - interval '48 hours' and action = 'order_created'
  group by 1 order by 1 desc;"
```

Success = every row shows `tokenless = 0` for the last 48h. Then set
`REQUIRE_TABLE_TOKEN=true` in Vercel (Production) and redeploy. Verify:

```bash
curl -s -o /dev/null -w '%{http_code}\n' -X POST https://dokanstore.xyz/api/public/order \
  -H 'content-type: application/json' \
  -d '{"projectSlug":"<slug>","tableSlug":"table-1","items":[{"productId":"<uuid>","quantity":1}]}'
# expect 403 — no token, no order
```

Rollback: set `REQUIRE_TABLE_TOKEN=false` and redeploy. No migration to reverse.

---

## 5. What the agent verified itself (for contrast)

| Claim | How it was proven |
| --- | --- |
| A1 token format preflight | `select count(*) from public.tables where qrcode !~ '^[0-9a-f]{32}$'` → **0** |
| Token resolves in-DB, never in route memory | live: valid token 200, wrong token 404, no token 403 |
| Legacy menu URL never 404s | enforcing server: `HTTP 200`, `orderingEnabled:false` |
| Storefront no longer lists tables | 1 menu link in the HTML (the browse link), 0 `?k=` leaks |
| `Referrer-Policy` | menu URL `no-referrer`, `/login` unchanged |
| Sentry cannot receive a token | 19 unit tests + a source guardrail on all three runtimes |
| Migration applied | ledger 27 → 28, column present, entitlement grants still locked |
| Signup gate | 400 missing-token, 400 misconfigured-secret, **503 fail-closed in production**, 0 users created |
| Env validator fails closed | `VERCEL_ENV=production npm run env:validate` → exit 1 listing all five |
