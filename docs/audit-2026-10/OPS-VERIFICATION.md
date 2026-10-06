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

## 5. Email confirmation: who unblocks a merchant (amendment A5 / decision 3)

Confirmations are ON and the signup route creates accounts **unconfirmed**. That is correct
security-wise and a hard operational dependency: **until SMTP is configured (section 3), no
merchant can confirm themselves, and the only way forward is the super-admin panel.**

**Owner action - configure a transactional sender** (Dashboard -> Authentication -> SMTP).
The built-in sender is heavily rate-limited and usually lands in spam; Resend, SendGrid and
Postmark all work.

- [ ] SMTP host / port / user / password set
- [ ] Sender address on a domain with SPF + DKIM
- [ ] End-to-end test: register a real address, confirm the mail arrives, click the link, sign in

**Shipped escape hatch (use it while SMTP is pending):**

1. Open `/super-admin/users` (new nav item: the accounts page). It lists every account whose
   `email_confirmed_at IS NULL`.
2. Press the confirm button on the row. That posts to
   `/api/super-admin/confirm-user?userId=<uuid>`, which
   re-checks `is_super_admin()` at mutation time (not at page load), rate limits per admin
   (30/min), reads the user FIRST so an already-confirmed account answers `alreadyConfirmed`
   instead of a success that changed nothing, and writes `user.confirm` to
   `super_admin_audit_log` with the target user id and email.
3. Verify: the row disappears from the list and the merchant can sign in.

**Self-service resend:** the register success screen and the login error path (when GoTrue
answers `email_not_confirmed`) both offer a resend ->
`POST /api/auth/resend-confirmation`. Budgets: 3 per 15 min per address, 10 per hour per IP.
The response is identical whether or not the account exists, so it is not an existence oracle.

```bash
curl -s -o /dev/null -w '%{http_code}\n' -X POST https://dokanstore.xyz/api/auth/resend-confirmation \
  -H 'content-type: application/json' -d '{"email":"someone@example.com"}'   # expect 200
```

A 200 for an address with no account is the DESIGNED behaviour, not a bug. If it answers 200
and no mail arrives, the SMTP configuration (above) is the problem - not this route.

---

## 6. What the agent verified itself (for contrast)

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
| A6 supplied-but-wrong token | live, flag OFF: `'junk'` / `'table-1'` / `42` → **404** (all three were ACCEPTED before A6) |
| A6 well-formed token, no match | live: 32 hex of zeros → 404, decided by the RPC |
| A6 tokenless budget | live: 11 rapid tokenless orders → `400` x10 then **429**; `orders` still at baseline 1 (no side effects) |
| A6 guardrail | the new guard tests were run **RED** against the previous guard (9 failures) → GREEN 24/24 |
| A5 unconfirmed login | 10 unit tests: only ONE error kind offers a resend; unknown errors never surface a raw provider string |
| A5 signup contract | 19 route-level tests (DB + network mocked): payload shape, fullName TYPE and 2..80 length, password classes, Turnstile refusal creating nothing, account created with `email_confirm:false` |

---

## 7. Realtime isolation probe (audit T2 #5, amendment A7)

The dashboard (`live-refresh.tsx`) and the kitchen board (`use-kitchen-orders.ts`) subscribe to
`orders` with **no project filter** — a filter combined with RLS made Realtime drop every event,
so the filter was removed and the entire cross-tenant guarantee now rests on the assumption
"Supabase Realtime honours RLS for `postgres_changes`". That assumption had never been tested.

`scripts/realtime-probe.ts` tests it. It creates its **own throwaway tenants** (two projects +
one confirmed user, membership in one of them), mirrors the app's subscription exactly, and
deletes every fixture afterwards. Your live stores are never touched.

```bash
cd ~/dokan-v3
node scripts/realtime-probe.ts --dry-run        # prints the plan, creates nothing
node scripts/realtime-probe.ts                  # production (keys from .env.local)
node scripts/realtime-probe.ts --url http://127.0.0.1:54321 \
  --anon-key <local anon key> --service-key <local service_role key>   # local Supabase stack
```

Exit codes: `0` isolation proven · `1` **LEAK — stop** · `2` bad args/env, or fixtures survived
cleanup · `3` INCONCLUSIVE (the own-tenant event never arrived, so the absence of a foreign
event proves nothing — check Realtime before trusting anything).

### Result — run by the agent, 2026-10-06, against production (exit 0)

```
date: 2026-10-06   target: production (ehbsdfnyetvszjcftaxh)   exit: 0
own-tenant order arrives        [x]  (first event ~3.5s; one cold-channel run took ~18s)
foreign-tenant order absent     [x]  (id never seen on either channel, even after a 30s drain)
anonymous client receives none  [x]
cleanup: probe projects=0  staff=0  probe orders=0   (live tenant counts unchanged: 2/2/1)
```

The decisive evidence is the id ledger the probe prints — the foreign order's id appears in
NO channel, so "isolated" cannot be a counting artefact:

```
arrivals on the user channel: OWN(project A) 1a03f47b@3.5s, ANON-TARGET 7e540646@67.0s
arrivals on the anon channel: none
id ledger:
  OWN         1a03f47b  user-channel=true   anon-channel=false
  FOREIGN     23166e45  user-channel=false  anon-channel=false
  ANON-TARGET 7e540646  user-channel=true   anon-channel=false
```

(The event that reads `unlabelled` in earlier runs is ANON-TARGET: an order in the
subscriber's OWN tenant, which the user channel legitimately receives.)

**Conclusion: Supabase Realtime honours RLS for `postgres_changes`.** Isolation holds with no
project filter, so the filter stays removed and there is no need for a private channel.

**Latency note (new information, not an isolation finding):** delivery measured **~3.5s** for
the first event on a warm channel and **~18s** on a cold one — not the "~1s" the code comment
in `use-kitchen-orders.ts` claims. The 30s fallback poll is therefore doing real work, and a
"realtime is instant" assumption should not be built on. Worth a look in W5 (perf) rather than
here.

**If it returns 1 (a leak):** do NOT ship the runtime alarm. Add
`filter: 'project_id=eq.<id>'` to both subscriptions and re-run the probe; if the filter also
suppresses the own-tenant event (the reason it was removed the first time), the correct fix is a
Realtime **private** channel with `realtime.messages` RLS — not `postgres_changes`.

---

## 8. The accessibility gate (axe, owner decision 6)

`axe` is BLOCKING on `/login`, `/register`, `/dashboard/pos`, `/dashboard/orders` and one public
menu URL: zero `serious`/`critical` violations.

```bash
cd ~/dokan-v3
npm run a11y                                             # target = E2E_BASE_URL or production
E2E_BASE_URL=http://localhost:3000 E2E_MENU_PATH=/estikana/menu/table-1 npm run a11y
```

- It uses `playwright.a11y.config.ts` (Playwright's **bundled chromium**). The main
  `playwright.config.ts` pins `channel: 'chrome'` — the system Google Chrome — which is right
  for the e2e suite but would require installing Chrome into a CI runner.
- One-time browser download: `npx playwright install chromium`.
- The authenticated routes need a signed-in staff member; without one the spec **skips** rather
  than reporting a clean page it never reached (a redirect to /login measured as "POS is clean"
  is exactly the vacuous gate this finding is about).
- `E2E_MENU_PATH` is the public menu URL owner decision 6 names; unset means that route is
  skipped, never silently passed.

Record the run here:

```
date: __________  target: ______________________  result: ______
/login [ ]  /register [ ]  /dashboard/pos [ ]  /dashboard/orders [ ]  menu URL [ ]
violations (serious+critical): ____   (must be 0)
```

---

## 9. Structured data after deploy (audit T1 #5)

The fix is on the branch. Production TODAY still serves the old shape — the finding, captured live:

    jsonLd="[object Object]"                     <- the attribute, no JSON-LD body
    schema.org appears ONLY inside the React Flight payload (the prop, for hydration)

After the deploy, verify:

```bash
curl -s https://dokanstore.xyz/<slug>/menu/table-1 | grep -o 'application/ld+json.{0,200}'
#   expect a real body: {"@context":"https://schema.org","@type":"Restaurant","name":…
curl -s https://dokanstore.xyz/<slug>/menu/table-1 | grep -c 'jsonLd="\[object Object\]"'   # must be 0
```

Then Google's Rich Results Test on the URL → "Restaurant" detected.

```
date: __________  ld+json body: yes/no ____  old attribute count: ____  Rich Results: __________
```

## 10. Weekly Core Web Vitals budget report (Wave 5 T3)

Cron job `010c04282d5d` — "CWV budget report (weekly)" — runs **every Monday 09:00 (+03)** from
`/home/ammar/dokan-v3`, delivery `local` (saved under `~/.hermes/cron/output/`). A breach opens a
task, not a page.

```bash
cd ~/dokan-v3 && node scripts/cwv-report.mjs            # exit 1 on a budget breach
CWV_WINDOW_DAYS=30 node scripts/cwv-report.mjs          # a different window
```

Budgets: LCP p75 <= 2500ms on `/<slug>/menu/*`, <= 1800ms on `/`, INP p75 <= 200ms.

**Baseline 2026-10-06** (last 7 days, paths with > 20 samples): 18 rows reported, **0 budgeted rows
judged** — the public menu has fewer than 20 LCP samples, so the budgeted paths are NOT MEASURED yet
and a green run must not be read as "fast" (the script says so itself). The slowest rows are the
dashboard routes, which have no agreed budget: LCP p75 **4261ms** `/dashboard`, **3440ms**
`/dashboard/kitchen`, **2819ms** `/dashboard/pos`; FCP p75 up to 2748ms. Recorded as an observation
for the owner, not as a breach.

---

## 11. Default privileges for future tables (audit T2 #14)

The repository's `0000_init.sql:2019-2020` grants `anon` and `authenticated` ALL on FUTURE tables in
`public` (the platform bootstrap). No migration ever revoked it, yet production measures **0** such
grants — so the live database was cleaned outside this repository and a fresh one (`supabase db
reset`, the CI job) rebuilds the exposed version. `20261006150000_default_acl_hardening.sql` now
revokes the `postgres`-owned defaults so the repository produces what production runs.

**Owner action on the hosted project** (this is the part the repository cannot do — the platform-owned
`supabase_admin` grants answer "permission denied to change default privileges"):

1. Supabase dashboard → **Settings → API → "Automatically expose new tables"** → **off**
   (the `auto_expose_new_tables = false` this repo sets for the local stack).
2. Verify with this query in the SQL editor:

```sql
SELECT r.rolname AS owner, n.nspname AS schema, d.defaclobjtype, a.grantee::regrole::text, a.privilege_type
  FROM pg_default_acl d
  JOIN pg_roles r ON r.oid = d.defaclrole
  JOIN pg_namespace n ON n.oid = d.defaclnamespace,
  LATERAL aclexplode(d.defaclacl) a
 WHERE d.defaclobjtype IN ('r','S')
   AND a.grantee IN ('anon'::regrole, 'authenticated'::regrole);
-- Expect: no row with nspname = 'public'.
```

**Do NOT revoke the `storage` (22 entries, owned by `postgres`) or `graphql` / `graphql_public` (44,
owned by `supabase_admin`) defaults.** Those belong to platform services, not to this application's
data; production's count for them is recorded here as the baseline (2026-10-06): storage 22,
graphql* 44. Record the hosted setting here:

```
date: __________  "Automatically expose new tables": off/on ____  owner: __________
```
