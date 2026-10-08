## What this is

The 2026-10 audit remediation: **37 findings** (22 frontend T1 #1–#22, 15 backend T2 #1–#15) across six waves, plus everything the owner asked for in the second round (decisions **D1–D4**, evidence **E1–E6**, deliverables **R1–R4**). Branch `fix/audit-remediation-20261005`, base `5188588`.

Tracker: `docs/audit-2026-10/REMEDIATION.md` (one row per finding: DONE 56 · PARTIAL 1 · RETRACTED 2 · RE-SCOPED 2, plus the D1–D4 section).

---

## By wave

**W0–W1 — the Critical: anonymous cross-tenant writes (T2 #1).**
`7f881e9` adds `resolve_table_by_token` (SECURITY DEFINER, pinned `search_path`, `REVOKE`d from `anon`/`authenticated`) + a unique index on `tables.qrcode`. `5ad613e` moves the token resolution into the database so the secret never enters route memory; `488e46e` makes a supplied-but-wrong token **always 404** (never 200, never 403) and tightens the tokenless budget (10/min, 60/h) while the rollout window is open; `208539b` turns a non-JSON body on the public route into a 400. `70c9668` scrubs the token from all three Sentry runtimes and sets `Referrer-Policy: no-referrer` on the menu subtree. `6e1f772` requires a confirmed inbox + a solved CAPTCHA at signup; `736800b` adds confirm-by-hand + resend. Public `/api/public/bill` and `/api/public/waiter` are **deleted** (decision 2).

**W2 — interaction/a11y mechanics (T1 #13/#14/#20/#21/#4/#6 …).** install-prompt became `role="status"`; `dashboard/error.tsx`'s `role="alert"` no longer wraps interactive content; Escape handlers on the POS cart + picker; `status-chip` delivered-tone contrast; `aria-busy` on checkout; modal focus fallback + opener restoration. `lint` went 26 → **0**.

**W3 — WCAG gates.** `scripts/check-touch-targets.mjs` (found 5 sites beyond the plan, including two 44×40 steppers → 44×44); `@axe-core/playwright` + `e2e/a11y.spec.ts` + a dedicated config using **bundled chromium** (the main config pins system Chrome, which CI cannot provide) as a **blocking** CI gate. The focus ring's real root cause was an unlayered `.input { outline: none }` beating `@layer base` — fixed to `outline: 2px solid var(--color-primary)` (**6.29:1** measured, survives forced-colors), and `--color-border-control` (#767B74) replaced a 1.18:1 control border.

**W4 — design/i18n/legibility.** `lang` now follows the script of the text, not the toggle (stated deviation, `dc8dbca`); `--radius-xl` 12 → 20px (`f853f08`, guard RED first); Arabic-Indic digit gate; print sheet lang/alt; global-error viewport; title flash; the Arabic legibility floor at **11.5px** over **65 real uses in 29 files** (`c566765` — the plan's grep had missed `text-[10.5px]`).

**W5 — SEO/headers/CWV.** JSON-LD was proven broken live (`jsonLd="[object Object]"` in production's DOM) and rebuilt server-side (`src/lib/jsonld.ts`); `X-XSS-Protection` removed and its **absence** asserted; `scripts/cwv-report.mjs` + a weekly job; the menu route's `SSG + searchParams` contradiction (`DYNAMIC_SERVER_USAGE`) fixed in `6febfa8`.

**W6 — schema/privileges/impersonation.** `9135bdc`'s drop is now **deferred (D1)**; `a9f4855`+`18a6ad8` fix the default-privilege drift with a permanent assertion; `628a6b0`+`51e6908` remove the plaintext refresh token at rest, cap impersonation at 15 minutes in the constraint itself, and make the marker single-use.

Beyond the 37: 16 non-JSON-body 500s, a Turnstile misclassification, a "6 characters" hint on a min-10 form, the menu route's build contradiction, `DESIGN_SYSTEM.md` radius drift, the privilege drift, CI fetching Google Fonts at build time (now self-hosted), an uncommitted lockfile, and a pgTAP assertion placed after `finish()`.

---

## Evidence (E1–E6)

### E1 — Realtime two-tenant probe: **RAN, verdict INCONCLUSIVE (stated plainly)**
`scripts/realtime-probe.ts` ran against the **real production Supabase** — not a branch, not a local stack. Transcript (2026-10-06):

```
[  4545ms] fixtures ready: A=probe-rt-a-… B=probe-rt-b-… (real tenants untouched)
[  4831ms] signed in as the probe user (member of A only)
[  5554ms] channel SUBSCRIBED (no filter — same as the dashboard/KDS)
[ 36504ms] FAIL  own-tenant order arrives — inserted into A, event received: false
[ 67364ms] PASS  foreign-tenant order does NOT arrive — no event for B (events before=0)
[ 99321ms] PASS  anonymous subscriber receives nothing — no event for an unauthenticated client
[129325ms] VERDICT: INCONCLUSIVE - the own-tenant event never arrived, even after the drain,
[129325ms]   so the absence of a foreign event proves nothing.
[133596ms] cleanup verified: probe projects=0 staff=0 probe orders=0
```

The **positive control failed**, so this probe does **not** prove tenant isolation. What isolation rests on today: the publication contains only `orders` + `order_items`, RLS is on for **21/21** public tables, all **24** `SECURITY DEFINER` functions pin `search_path`, and `realtime-guard` filters incoming rows by project. Re-run after the deploy and treat *that* as the evidence. Operationally relevant: Realtime delivery to a subscribed user channel did not happen within 130s in production — the kitchen's 30-second polling fallback is load-bearing.

### E2 — `test:db` substitute + the production-shaped run
`npm run test:db` cannot run on this host (no `docker` group; `sudo` needs a password that must not be typed into chat). Substitute: the CI job **Fresh database · Security assertions**, green on every head (final head below). Beyond a fresh DB, the **pending migration set was applied against production inside one transaction and rolled back**:

```
begin;  <20261006150000>  <20261006160000>
constraints on impersonation_sessions: impersonation_max_duration,
  impersonation_super_admin_session_no_refresh, impersonation_target_session_no_refresh,
  impersonation_used_requires_ended
used_at column: 1
default-ACL rows for web roles in public: 0
impersonation_sessions rows: 0
rollback;
EXIT=0        used_at exists after rollback: 0
```

### E3 — Drift report: `docs/audit-2026-10/DRIFT-REPORT.md`
The drift in one line: **`0000_init.sql:2019-2020` grants `anon` and `authenticated` ALL on every future `public` table; production grants none** — the environment was cleaned outside the repository, the source was not, so a fresh `db reset` rebuilds the exposed version and production looks right. Remaining platform defaults are `storage` (22 rows) and `graphql`/`graphql_public` (44 rows), owned by `supabase_admin`, which the migration runner cannot change (`permission denied to change default privileges`) — that is why the remedy is the dashboard's `auto_expose_new_tables` toggle plus a verification query. Only `20261006150000` touches the drift and it is a **no-op on production** (its purpose is making a fresh DB match production). The report includes all eleven read-only pre-flight queries with their recorded baseline, per-migration idempotency, the `NOT VALID` analysis, and an explicit statement of what it does **not** establish (no Supabase branch, no restored snapshot were reachable).

### E4 — Migration manifest: `docs/audit-2026-10/MIGRATION-MANIFEST.md`
Eight new migrations, five already applied (ledger head `20261006130000`), one pending **before/with** the deploy (`20261006150000`), one pending **immediately after** the deploy (`20261006160000`), one **deferred** (D1). Each with purpose, destructiveness, rollback and apply timing.

### E5 — Security-critical diff pointers (for hand review)

| area | files | commits |
|---|---|---|
| (a) `resolve_table_by_token` + grants | `supabase/migrations/20261006090000_table_scan_token.sql` | `7f881e9` |
| (b) `/api/public/order` | `src/app/api/public/order/route.ts`, `src/lib/public-write-guard.ts`(+test) | `488e46e`, `5ad613e`, `208539b` |
| (c) signup + Turnstile + manual confirm | `src/app/api/auth/signup`, `src/app/api/auth/resend-confirmation`, `src/lib/turnstile.ts`, `src/app/super-admin/**`, `src/lib/auth-errors.ts` | `6e1f772`, `736800b`, `d3999d4` |
| (d) impersonation **at rest** | `src/lib/super-admin.ts`, `src/app/api/super-admin/impersonate/**`, `supabase/migrations/20261006160000_impersonation_at_rest.sql` | `628a6b0`, `51e6908` |
| (e) Sentry `?k=` scrubbing + Referrer-Policy | `src/lib/sentry-scrub.ts`(+test), `next.config.ts`, `src/app/api/public/order/route.ts` | `70c9668`, `d81802d` |

**Correction to the brief:** (d) is **not encryption**. The remediation took option A — the actor session stores an **access token only**, a CHECK forbids the refresh token, the 15-minute ceiling is in the constraint, and `used_at` makes the marker single-use — so there is **no `IMPERSONATION_ENCRYPTION_KEY`** to set. The runbook says so at step 1.

### E6 — Confirmations with evidence
- **(a) token-format preflight returns 0**: `SELECT count(*) FROM public.tables WHERE qrcode !~ '^[0-9a-f]{32}$'` → **0**.
- **(b) tokenless orders are rate-limited tighter while the flag is false and logged with `token_present=false`**: covered by `src/lib/public-write-guard.test.ts` (vitest, in the 237) and measured at the log: `order_audit_logs` → `with-token` = 1, `tokenless` = **0**. The 10/min · 60/h window and the `token_present=false` metadata are in `src/lib/public-write-guard.ts`.
- **(c) a supplied-but-wrong token is 404 even with the flag false**: four shapes probed against the final build — `"junk"` → **404**, 32-hex unknown → **404**, number `42` → **404**, `"table-1"` as the token → **404**; and `orders` count **1 before, 1 after** the probes, so nothing was written.

---

## Deliverables (R1–R4)

- **R1** `docs/audit-2026-10/DEPLOY-RUNBOOK.md` — nine ordered steps, each with a command, a verification, and a rollback; env vars split required/not-required; the deploy→impersonation-migration order and the accepted super-admin-only window.
- **R2** `scripts/smoke-test.sh` — the ten checks (tokenless behaviour per flag, malformed/unknown token 404, valid token accepted, bill/waiter 404, `tables.qrcode` unreadable by anon through PostgREST, no `jsonLd="[object Object]"`, real JSON-LD present, no `x-xss-protection`, `Referrer-Policy: no-referrer` on the menu, `/api/health` minimal vs detailed) plus the two D3 properties. Read-only unless `SMOKE_ALLOW_WRITES=1`.
- **R3** `docs/audit-2026-10/POST-DEPLOY-MONITORING.md` — the daily tokenless query, the 48-hour flip condition (not a date), the flip commands with expected status codes, the old-QR signals, and the flag rollback.
- **R4** `REMEDIATION.md` + `OPS-VERIFICATION.md` (§13 deferred DDL with the 7-day re-evaluation, §14 the realtime probe's honest verdict).

### D3 in detail (the one that changed behaviour)
The public menu is cached again: `revalidate = 60`, `dynamic = 'force-static'`, no `searchParams` read, the token read client-side and enforced server-side, on-demand invalidation through the existing `menu-${projectId}` tag whose only writer is `products-utils.ts`. **The first measurement failed**: without `force-static`, Next built its router state tree from the request URL and emitted the token into the React Flight payload (`"c":["","estikana","menu","table-1?k=<token>"]`), so the HTML differed with and without `?k=` and the token was in the page source. After the fix: md5-identical **45199-byte** responses, **0** occurrences of `?k=` or the token, and `e2e/menu-cache.a11y.spec.ts` green (3 tests, including the client-side gate with the flag true).

---

## Gates on this head

| gate | result |
|---|---|
| `npx tsc --noEmit` | **0 errors** |
| `npm run lint` (max-warnings 0) | **0 problems** (was 26 at W2, 1 mid-D3 — the lint gate caught a `setState`-in-effect in my own change, fixed in `b732531`) |
| `npx vitest run` | **237 passed / 237**, 20 files |
| `npm run build` | **BUILD_EXIT=0** |
| node gates: touch / json-body / hermetic / font | all **ok** (touch: 111 tsx files) |
| `npm run env:check` | **28 vars documented** |
| Playwright axe + the D3 cache spec | **12/12 passed** on the final build (`b3791cb`): 9 axe/visual + 3 cache-identity/client-gate. Two of them failed in the first full run — both test-setup artifacts, both fixed and stated in the commit: `page.content()` is the post-hydration DOM (now raw responses), and two `next start` processes share `.next/cache` so the flag-true target served flag-false HTML (the strict target is now a `next dev` server, which is stated in the test). |
| CI `Fresh database · Security assertions` | linked below |

## Deploy order (summary — full detail in the runbook)

1. Vercel env vars (required: `TURNSTILE_SECRET`, `NEXT_PUBLIC_TURNSTILE_SITE_KEY`, `HEALTH_TOKEN`, `REQUIRE_TABLE_TOKEN=false`, `ORDERS_TOKEN_TELEMETRY=true`; **not** `IMPERSONATION_ENCRYPTION_KEY`).
2. Resend configured + a real inbox confirmed on **preview** before confirmations matter.
3. Supabase Auth settings (`jwt_expiry=1800`, confirmations ON, min password 10, captcha).
4. Snapshot.
5. `20261006150000` (non-destructive).
6. Deploy.
7. `20261006160000` immediately after (old code writes what the new CHECK rejects) — verify the four constraints + `used_at`, then start/end an impersonation.
8. `scripts/smoke-test.sh` → `failures: 0`.
9. Rollback per step (table in the runbook).

## Not in this PR (owner actions / blockers)

- **D1**: the `service_requests` drop is deferred to `DEFERRED-DDL/`; re-evaluate 7 days after the deploy.
- **Nothing is deployed.** Production still serves the pre-fix code (verified live: `jsonLd="[object Object]"` and `x-xss-protection` still present there).
- **`REQUIRE_TABLE_TOKEN` stays false** (D4) until 48h of zero tokenless orders — query in R3.
- `npm run test:db` is impossible on this host; the CI database job is the substitute.
- The public menu cannot be fully prerendered (`generateStaticParams` stays empty by design, because a real list would put a DB query in the build and break the hermetic-CI gate), so paths are rendered on first request and cached after.
- **Realtime isolation stays unproven** until the probe's positive control passes (E1).

### Checklist

| item | status |
|---|---|
| D1 deferred drop + README + caveats | **DONE** — `2353b6a`, `3e74971` |
| D2 apply order + idempotency + `NOT VALID` analysis | **DONE** — `51e6908` |
| D3 caching / token out of the render / identical-HTML test | **DONE** — `2d6ff0a`, `b732531` (leak found and fixed) |
| D4 flag stays false + 48h gate documented | **DONE** — `ddb9e23` |
| E1 realtime probe run + honest verdict | **DONE (INCONCLUSIVE)** — `b640c03`, `ddb9e23` §14 |
| E2 test:db substitute + production-shaped run | **DONE** — `6eab33d` §4 |
| E3 drift report + pre-flight queries + idempotency | **DONE** — `6eab33d` |
| E4 migration manifest | **DONE** — `6eab33d` |
| E5 security diff pointers (+ the encryption correction) | **DONE** — this description |
| E6 three confirmations with output | **DONE** — `6eab33d` baseline, `b640c03` |
| R1 deploy runbook | **DONE** — `ddb9e23` |
| R2 smoke test | **DONE** — `b640c03` |
| R3 post-deploy monitoring | **DONE** — `ddb9e23` |
| R4 tracker + OPS updates | **DONE** — `ddb9e23` |
| Full gates on the final head | **DONE** — the table above |
