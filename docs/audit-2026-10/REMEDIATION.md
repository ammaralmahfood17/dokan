# Remediation tracker — 2026-10 frontend + backend audits

Plan: `.hermes/plans/2026-10-05_235725-dokan-v3-full-remediation.md` (44 tasks, 6 waves).
Branch: `fix/audit-remediation-20261005` · Base commit `5188588` · Last updated 2026-10-06 02:20 +03.
Human-only steps: `docs/audit-2026-10/OPS-VERIFICATION.md`

Statuses: **DONE** (shipped + verified) · **PARTIAL** (part shipped, part blocked) ·
**TODO** · **RETRACTED** (finding was wrong) · **RE-SCOPED** (smaller/different than reported).

## Owner decisions recorded

| Date | Decision |
|---|---|
| 2026-10-06 | QR reprint is the owner's job; ship a banner until printed; `REQUIRE_TABLE_TOKEN` flips only after 48h of `token_present=false`. **No date-based flip.** |
| 2026-10-06 | `bill`/`waiter`: **DELETE** both routes, tests, references — no token-gated variant. |
| 2026-10-06 | Storefront `/<slug>` stops listing tables; shows the scan rule + one read-only browse link; legacy table URLs never 404. |
| 2026-10-06 | axe is a **BLOCKING** CI gate (0 serious/critical) on `/login`, `/dashboard/pos`, checkout, one public menu URL. The two Criticals are non-negotiable. |
| 2026-10-06 | **Email confirmation ON and CAPTCHA ON** — this SUPERSEDES the earlier "no confirmation, no CAPTCHA" accepted risk. Hosted settings verified by the owner. |
| 2026-10-06 | five deployment variables must exist in Vercel (prod + preview); boot fails closed without them. |
| 2026-10-06 | Amendments A1–A4 to the plan (preflight assertion, Referer/Sentry scrubbing, RPC-based resolution, bill/waiter deletion). |
| 2026-10-06 | Amendments A5–A9: manual confirm + resend UI + unconfirmed-login path; rollout-window hardening; run the realtime probe BEFORE any realtime alarm code; impersonation Option A; W1+W2 are the floor and W3+ waits on their evidence. |
| 2026-10-06 | Decision 3 = confirm-by-hand + resend (SMTP is not wired up yet); decision 4 = Turnstile. Implemented under the earlier 7/8 numbering. |

## Wave 0 — Preflight

| Task | Status | Evidence |
|---|---|---|
| W0-T1 baseline | **DONE** | `tsc` 0 · `lint --max-warnings 0` 0 · vitest 87/87 · `npm run build` clean |
| W0-T2 tracker | **DONE** | this file |
| W0-T3 live DB verification | **DONE** | `/tmp/audit-queries.sql`; results in §"Live production verification" |
| **A1** token-format preflight | **DONE** | `select count(*) from public.tables where qrcode !~ '^[0-9a-f]{32}$'` → **0**; no uppercase, no wrong length, no duplicates → enforcement is safe to flip and `TOKEN_RE` matches the data |

## Wave 1 — Security

| # | Finding | Sev | Status | Evidence |
|---|---|---|---|---|
| 1 | T2 #1 table scan token never checked (anonymous cross-tenant write) | Critical | **DONE** (enforcement dark, by design) | `7f881e9`, `8f9a78c`, `06906ff`; migration ledger 26→27; pgTAP `phase6_table_token.sql`; live 403 / 404 / 200 |
| 1b | Token must never enter route memory (**A3**) | Critical | **DONE** | `5ad613e`; resolution goes through `resolve_table_by_token`; no `select qrcode` in the route; live 200/404/403 after the rewrite |
| 1c | Token must never reach Sentry or a Referer (**A2**) | Critical | **DONE** | `70c9668`; `src/lib/sentry-scrub.ts` + 19 tests + a source guardrail on all three runtimes (run RED first); `Referrer-Policy: no-referrer` on the menu subtree, `/login` unchanged — both live-verified |
| 1d | Storefront published every table slug (decision 5) | Major | **DONE** | `470768c`; `/[slug]` shows the scan rule + 1 read-only link, 0 `?k=` in the HTML; legacy URL live `HTTP 200` with `orderingEnabled:false` |
| 2 | T2 #2 no email verification, weak passwords | Major | **DONE** | password floor `0566dad` (10 chars, login deliberately still 6); confirmation + Turnstile `a0b32b3`/`6e1f772` + `65987ce`: live **400 missing token / 400 misconfigured secret / 503 fail-closed**, zero accounts created. Hosted Auth settings = owner item |
| 3 | T2 #3 unauthenticated waiter/bill writes | Major | **DONE** (deleted per decision 2) | `b3aab0c`; both routes + their e2e cases + helpers removed; no gated variant |
| 8 | T2 #8 `/api/health` leaks alert config | Minor | **DONE** | `c3e96f8`; live probe: no `integrations` key without `HEALTH_TOKEN` |
| 9 | T2 #9 vitals write amplification | Minor | **DONE** | `3b35e6e`; 240→60/min + 512-byte cap |
| 10 | T2 #10 push/subscribe unvalidated | Minor | **DONE** | `3b35e6e`; shape validation + 10/h/user |
| 11 | Decision 1: merchant needs to know to reprint | — | **PARTIAL** | `02b03b2`; banner + `projects.qr_reprinted_at` (migration `20261006094000`, ledger 27→28, column grant asserted). The FLIP is an ops step — OPS-VERIFICATION §4 |
| 12 | Decision 8: deployment variables | — | **DONE** | `a0b32b3`; `.env.example` (24 vars documented, `env:check` 0); prod-only required set; `VERCEL_ENV=production env:validate` exits 1 listing all five |
| 4 | T2 #4 missing `order_items` index | Major | **RETRACTED** | index exists since `0006:81-82`; live query: **0 FKs without a covering index** |
| 13 | T2 #13 dead objects | Minor | **RE-SCOPED** | `order_sequences` does not exist in production (dropped); `service_requests` (0 rows) + unused routes remain → W6-T1 |
| 14 | T2 #14 default-privilege gap | Minor | **RE-SCOPED** | live `pg_default_acl` grants only to `postgres`+`service_role` → already closed; only the platform setting + assertion remain → W6-T2 |
| — | **Extra**: non-JSON body → 500 on `/api/public/order` | Major | **DONE** | `208539b`; the repo's own `e2e/resilience.spec.ts` R1 documented it as KNOWN FAILING; now a 400 and the test passes |
| — | **Extra**: register hint said 6 chars while the minimum is 10 | Minor | **DONE** | `6e1f772` |
| — | **Extra**: a wrong `TURNSTILE_SECRET` reported as a Cloudflare outage | Major | **DONE** | `65987ce`; the response body is authoritative → `misconfigured` + ERROR-level Sentry; live-verified |
| A5 | Confirmations ON with no SMTP: a merchant can sign up and then be permanently stuck | Major | **DONE** | `736800b`; `auth-errors.ts` (10 tests, resend offered for exactly one kind), login + register resend UI, `/api/auth/resend-confirmation` (3/15min per address, 10/h per IP, no enumeration answer), super-admin `POST /api/super-admin/confirm-user` + `/super-admin/users` + the new `user.confirm` audit action; password classes pinned as a conjunction; 19 route-level signup tests |
| A6 | Rollout window: a supplied-but-wrong token was treated as “no token” and ACCEPTED | Major | **DONE** | `488e46e`; three-way split in the guard (absent / malformed = **always 404** / well-formed), tight tokenless budget 10/min + 60/h per project, Sentry warning per tokenless acceptance. Guardrail proven **RED** against the old guard (9 failures) → GREEN 24/24, then live: `'junk'`/`'table-1'`/`42` → 404 (was accepted), tokenless x11 → 400×10 then **429**, orders still at baseline 1 |
| — | **Extra**: the same non-JSON → 500 as public/order on three UNAUTHENTICATED routes | Major | **DONE** (scope) | `d3999d4`; `/api/auth/signup`, `/api/auth/reset-password`, `/api/telegram/link` (×2) now 400. Found by the new signup route test. **14 further sites are behind a session** — listed below as a dated follow-up, not silently dropped |

**Wave 1 exit criteria: met except the enforcement flip, which is blocked on the physical QR
reprint.** Until then the fix ships dark: tokenless orders are accepted, recorded
(`order_audit_logs.metadata.token_present`) and flagged to Sentry — and, since A6, bounded by a
10/min + 60/h tokenless budget of their own. A supplied-but-wrong token is a 404 in the window
too, so the window cannot be used as a bypass.

**Dated follow-up (2026-10-06):** 14 `await request.json()` call sites remain without
`.catch(() => null)` — all behind a session: `pos/order:40`, `pos/cancel:34`,
`onboarding/project:60`, `push/subscribe:21`, `push/unsubscribe:20`, `staff/notification-prefs:48`,
`revalidate-menu:25`, `super-admin/{archive-project:38, create-project:39,
hard-delete-project:35, impersonate:40}`, `telegram/webhook:30`. There, malformed JSON is a
cosmetic 500 + Sentry noise from an authenticated caller rather than an anonymous lever, which
is why the fix was scoped to the unauthenticated set. Same one-line shape when it is done.

**Wave 1 gates:** `tsc` 0 · `lint` 0 · **vitest 187/187 (16 files)** · `build` 0 · `env:check` 0 ·
`env:validate` 0 (dev) / exit 1 (production simulation).
`npm run test:db` is **not executable on this host** (no docker group, sudo needs a password)
→ substituted by the PR's CI job and **verified green on the final W1 head `282d7bc`**:
`Fresh database · Security assertions` (supabase start + db reset + test db, incl.
`phase6_table_token.sql`), `Typecheck · Lint · Build`, `E2E is configured (not executed)` —
run 37385404716 was the first head, the pushed W1 head is the one recorded here.
Permanent fix in OPS-VERIFICATION §1.

## Wave 2 — Money path, data integrity, multi-tenant scale

| # | Task / finding | Status | Evidence |
|---|---|---|---|
| W2-T1 | ~~Index `order_items`~~ (T2 #4) | **RETRACTED, replaced** | The indexes existed since `0006:81-82`. Replaced by a stronger gate: assertion 5 of `phase7_no_permissive.sql` fails CI when ANY foreign key in public lacks a covering index |
| W2-T2 | T2 #5 Realtime tenant isolation | **DONE** | `505fae3`. Probe FIRST (`scripts/realtime-probe.ts`, see the finding below), then defence in depth: `src/lib/realtime-guard.ts` + 7 tests, the guard wired into `live-refresh.tsx` and the KDS (insert/update/delete), and `supabase/tests/phase7_realtime.sql` (4 assertions, one of them general: no published table without RLS) — validated 4/4 |
| W2-T3 | T2 #6 middleware security model | **DONE** | `9c23070`. Comment states that `getSession()` is not an authorization decision and names the two real boundaries. Verified the only callers are the middleware fast path and the three routes that document it before forcing a server-side `getUser()` |
| W2-T4 | T2 #7 Telegram link code 32 → 128 bits | **DONE** | `a06a087`. `generateLinkCode()` (32 hex, CSPRNG) + webhook pattern widened to `{6,32}` + 5 tests including two source guardrails |
| W2-T5 | T2 #11 payment idempotency | **DONE** | `3043e39` (+ repair `20261006130000`). Live, throwaway project: same key twice → same expiry, ONE payment row; a new key extends normally. Ledger 28 → 31 |
| W2-T6 | T2 #12 order-replay race | **DONE** | `e114106`. Live CONCURRENT test: A `replayed:false`; B blocked ~1.1s on the unique index then `replayed:true` with A's id; exactly 1 order row |
| W2-T7 | T2 #5/#14 security suite | **DONE** | `62d2354`. `phase7_no_permissive.sql`, 5 class-level assertions, validated 5/5 against production inside a transaction with ROLLBACK |
| W2-T8 | Guardrail: no undocumented service-role route | **DONE** | `0c29289`. `scripts/check-public-write-gates.mjs` + a CI step after Lint. First run: 26 routes checked, 16 service-role routes, all documented. Also fails on a STALE entry, which is why the bill/waiter entries are gone (decision 2 / A4) |

**Wave 2 gates:** `tsc` 0 · `lint` 0 · **vitest 199/199 (17 files)** · `build` 0 · `env:check` 0 · the new
`check-public-write-gates` step 0. `npm run test:db` still substituted by the PR's CI job.

**Defects found and fixed WHILE verifying W2** (all mine or in my tooling, recorded so the next
person does not repeat them):

1. **I broke payments for a few minutes.** `20261006110000` was recorded as applied while its
   `ALTER TABLE` / `CREATE INDEX` statements were missing from the file that ran: the file had
   been regenerated by splitting the previous text on the first occurrence of
   `DROP FUNCTION IF EXISTS public.record_payment_and_renew`, and that exact string also appears
   inside the file's own ROLLBACK comment — so the split truncated the head away. The function
   then referenced a column that did not exist, and **every manual payment failed at runtime**
   (`column client_request_id does not exist`); PL/pgSQL resolves a body's SQL at first
   execution, not at `CREATE`, which is why the migration itself reported success and the ledger
   recorded it. Fixed by repairing `20261006110000` for fresh resets AND adding idempotent
   `20261006130000` for the already-migrated database, with assertion blocks in both.
2. A wrong `TURNSTILE_SECRET`... (see Wave 1) — this one is different: the first version of the
   probe's own diagnostics used `'A ' || create_order_transactional(...)`, and `||` is the **JSONB
   concatenation operator**, so the label was coerced to jsonb and the call failed with
   `Token "A" is invalid` BEFORE the function ran. A test harness can fail in ways that look
   exactly like a product bug.
3. `psql -c` prints the command tag (`INSERT 0 1`) and re-interprets quoting; a captured id
   silently became "id\nINSERT 0 1". Every probe now writes a `.sql` file and passes values as
   psql variables (`:'items'`), which also removed a JSON-escaping trap.

## Wave 3 — Accessibility, WCAG 2.2 AA

| # | Task / finding | Status | Evidence |
|---|---|---|---|
| W3-T1 | T1 #1 focus indicator 1.47:1 (**Critical**) | **DONE** | `0e6f5f5`. Test written first and run RED (3 failures) -> GREEN. `outline: 2px solid var(--color-primary)` + offset: 6.29:1 on white, 5.97:1 on bg, and it survives forced-colors mode where a box-shadow is not painted at all |
| W3-T2 | T1 #2 control boundaries 1.18:1 (**Critical**) | **DONE** | `0e6f5f5`. `--color-border-control: #767B74` on `.input/.select/.textarea`; the test measures > 3:1 on all three surfaces. Dividers (.card, tables) keep the hairline and that is asserted, so the fix cannot turn the UI heavy |
| W3-T3 | T1 #3 twelve orphaned labels | **DONE** | `a75fff2`. jsx-a11y rules added; they surfaced **26 errors** (12 labels + 14 interactions) = the work list. All 12 now pair htmlFor/id, the group label became fieldset/legend. `npm run lint` 0 |
| W3-T4 | T1 #4 badge contrast 4.34:1 | **DONE** | `0e6f5f5`. delivered -> text-secondary: **4.68:1**. The guard reads the COMPONENT (status-chip.tsx), not just globals.css - the reason this finding survived the first audit |
| W3-T5 | T1 #6 modal focus in/out | **DONE** | `a75fff2`. Fallback focuses the panel (`tabIndex={-1}`) so a no-input dialog is still announced; the opener is remembered and refocused on unmount (WCAG 2.4.3) |
| W3-T6 | T1 #7 44px touch targets | **DONE** | `a75fff2`. **Five** sites, not the three the audit named: the gate caught the POS quantity steppers at `h-11 w-10` (44x**40**) - the most-tapped controls in the app. `scripts/check-touch-targets.mjs` runs in CI (111 tsx files, clean) |
| W3-T7 | T1 #13 / #14 dialog & alert misuse | **DONE** | `a75fff2`. The install prompt is a passive `role="status"`; `role="alert"` no longer CONTAINS the retry button and accordion - the assertion is its own sr-only live region |
| W3-T8 | T1 #15 half-implemented tabs | **DONE** | `a75fff2`. `role="group"` + `aria-pressed` (filters over one region, matching the other filters in the app) |
| W3-T9 | T1 #20 / #21 | **DONE** | `a75fff2`. `aria-busy` on the checkout CTA; the kitchen's page-wide click keeps a non-interactive role so it is not read as an affordance |
| W3-T10 | the axe gate (decision 6) | **DONE** | `596a3cb`. `e2e/a11y.spec.ts` + `playwright.a11y.config.ts` + `npm run a11y`. **Results, bundled chromium, real runs:** production `https://dokanstore.xyz` -> `/login` PASS, `/register` PASS, `/estikana/menu/table-1` PASS. Local dev build -> same three PASS (4 passed / 2 skipped: no session for the authed routes). The main playwright config pins `channel: 'chrome'` (system Chrome), so the a11y config uses the bundled browser and changes nothing else |

**The gate earned its keep before it was even finished - it found two real defects:**

1. **The focus ring never reached a single input (audit T1 #1, still broken after the first fix).**
   The computed style in Chrome read `outline: none` on a focused input while the skip link - which
   has no competing rule - showed the new ring. `*:focus-visible` sat inside `@layer base`, and a
   cascade layer LOSES to an unlayered author rule at equal specificity; `.input` declared
   `outline: none`. So the one ring that must always win was the one that could always be
   outranked. Fixed in `8344570` and re-measured: `input#email -> rgb(79, 70, 229) solid 2px`. A
   unit test could not have caught this - it needed the computed value from a browser.
2. **My own W1 Turnstile container had `aria-prohibited-attr` (serious).** `aria-label` on a `div`
   with NO role is prohibited, so the label was dropped and the challenge announced unlabelled;
   `role="group"` makes it legal (`ee59278`). Found on a dev-mode run, where the widget's empty
   state is visible long enough to measure — production renders the iframe inside it, which is why
   the live run passed.

The spec also refuses to grade a page it never reached: a route the browser was redirected away
from is SKIPPED with a named reason, and a route that did not RENDER fails with that wording
(before this guard, a local 500 was reported as a `document-title` violation of the menu page).

**Two CI failures on this branch, both resolved, one of them a real trap:**

- `npm ci` failed on BOTH jobs: `package.json` required `@axe-core/playwright` while the committed
  `package-lock.json` predated the install. `npm ci` does not resolve - that is its value - so the
  branch was broken in CI while green locally. Fixed by committing the lockfile (`d4225ba`).
  Lesson: `git add -A <dirs>` is not a substitute for checking what a dependency install touched.
- `next build` failed once in CI with `Module not found: Can't resolve
  '@vercel/turbopack-next/internal/font/google/font'`. `src/app/layout.tsx` imports
  `Cairo` from `next/font/google`, so **every build fetches the font from Google at build time**;
  when the runner cannot reach fonts.googleapis.com the build fails. It is unrelated to the audit
  changes (the same head rebuilt green minutes later) and it is a **known robustness gap, dated
  follow-up: self-host Cairo via `next/font/local`, or pin the font fetch**. Not one of the 37
  findings, so it is recorded here rather than silently absorbed.

**Wave 3 gates:** `tsc` 0 - `lint` 0 (was 26 errors) - **vitest 209/209 (17 files)** - `build` 0 -
`check-touch-targets` 0 - `check-public-write-gates` 0 - `env:check` 0.

**The interaction class is 14 findings the audit never counted.** The audit listed the 12
labels (T1 #3) and the kitchen handler (T1 #20) but not the other 13 click-handler-on-a-div
sites the same rule catches. Each was fixed by its honest shape rather than a
`eslint-disable`: overlays got `role="presentation"` + an Escape path (the semantic dialog is
the panel inside), the settings confirm dialog lost an inner `onClick={stopPropagation}` panel
that existed only to cancel another handler, and the dropzone got `role="button"` + Enter/Space
because it cannot BE a button - the hidden file input lives inside it.

## Waves 4–6 — not started

| Wave | Findings | Status |
|---|---|---|
| W4 design/i18n | T1 #8–#12, #16–#19 | TODO |
| W5 SEO/headers/perf | T1 #5, #22 + CWV budget | TODO |
| W6 hardening | T2 #13 (remainder), #14, #15 | TODO |

## Live production verification (2026-10-06, read-only unless stated)

- **26/26 → 28 migrations**, each `db push --dry-run` listed exactly one pending file: **no drift**.
- **21/21 public tables RLS-enabled**; **0 permissive policies**; **0 SECURITY DEFINER without a
  pinned `search_path`**; **0 function bodies using the spoofable `coalesce(auth.uid(), p_caller…)`**.
- **0 foreign keys without a covering index** (80 indexes total).
- `authenticated` holds **SELECT only** on `orders`/`order_items`; column-UPDATE limited to
  `projects`(4 cols + `qr_reprinted_at`) and `staff_members`(2 notify cols) → no escalation path.
- Realtime publication = `orders`, `order_items`. Cron: `expire_subscriptions` 03:00,
  `retention-sweeps` 04:10.
- Production volume is tiny — tables 2 · products 7 · orders 1 — so **this is pre-launch hardening,
  not incident response**.
- Two test orders were created during route verification and **deleted** (order + items + audit);
  `orders` is back at its baseline count of 1. Zero `probe-audit@` users exist.

## Corrections to the published audits

1. **T2 #4 retracted.** A truncated `grep … | head -80` inventory was reported as a database fact.
   Every "missing X" claim is now backed by a live query.
2. **T2 #13 partially retracted** (`order_sequences` was already dropped).
3. **T2 #14 re-scoped down** (the `postgres`-role gap was already closed).
4. Three findings the audits AND the plan missed were found during execution and fixed:
   the 500 on a non-JSON order body, the 6-vs-10 password hint, and the Turnstile
   misconfiguration classification.
5. Nothing else changed under live verification: T2 #8/#9/#10/#11/#12/#15 and Task 1 stand.

## Open blockers

| # | Blocker | Owner | Effect |
|---|---|---|---|
| 1 | **`sudo usermod -aG docker ammar`** (or run `npm run test:db` manually) | Ammar | The only gate that exercises the new SQL on a clean DB; CI covers it via the PR |
| 2 | **Print + place the new QR sheets**, then set `REQUIRE_TABLE_TOKEN=true` | Ammar | The Critical stays dark until this happens |
| 3 | Vercel: the five decision-8 variables (prod + preview) | Ammar | The deploy now FAILS to boot without them |
| 4 | Hosted Supabase Auth: confirmations ON, min password 10, JWT 1800 + SMTP for the mail | Ammar | Signup is unusable without a working mail path |
| 5 | Turnstile site + keys (`TURNSTILE_SECRET`, `NEXT_PUBLIC_TURNSTILE_SITE_KEY`) | Ammar | Required in production; signup refuses without them |
| 6 | Security/Performance Advisor output | Ammar | Could reveal something neither audit saw |

## Notes that must survive a context loss

- `.next/dev/types/validator.ts` caches the route manifest: after deleting a route, `tsc` and
  `build` fail on the deleted module until `.next` is cleared.
- `supabase gen types --db-url` needs Docker too — new columns/functions are hand-added to
  `src/lib/database.types.ts` in the generator's exact style, each with a comment.
- Next refuses two `next dev` servers from one directory (lock file): the second exits 0 and
  leaves its port dead, so a probe against it returns curl `000`. Probe one server at a time.
- `react-dom/server` renders under this repo's node vitest environment → presentational
  components are testable with no new dependency.
- `react-hooks/refs` rejects writing a ref during render; refresh refs inside an effect.
