# Remediation tracker — 2026-10 frontend + backend audits

Plan: `.hermes/plans/2026-10-05_235725-dokan-v3-full-remediation.md` (44 tasks, 6 waves).
Branch: `fix/audit-remediation-20261005` · Base commit `5188588` · Last updated 2026-10-06 00:50 +03.

Statuses: **DONE** (shipped + verified) · **PARTIAL** (part shipped, part blocked/declined) ·
**TODO** · **RETRACTED** (finding was wrong) · **RE-SCOPED** (smaller/different than reported).

## Owner decisions recorded

- 2026-10-06 — **No email confirmation, no CAPTCHA** on signup (merchant friction). Recorded as an
  explicit accepted risk in `supabase/config.toml` next to `enable_confirmations`.
- 2026-10-06 — `bill`/`waiter`: **gated, not deleted** (deletion is a product call, still open).

## Wave 0 — Preflight

| Task | Status | Evidence |
|---|---|---|
| W0-T1 baseline | **DONE** | `tsc` 0 · `lint --max-warnings 0` 0 · vitest 87/87 · `npm run build` clean (`/tmp/w0-baseline.log`, `/tmp/w0-build.log`) |
| W0-T2 tracker | **DONE** | this file |
| W0-T3 live DB verification | **DONE** (added during execution) | `/tmp/audit-queries.sql`; results in §"Live production verification" below |

## Wave 1 — Security

| # | Finding | Sev | Status | Evidence |
|---|---|---|---|---|
| 1 | T2 #1 table scan token never checked | Critical | **DONE** (enforcement pending reprint) | 3 commits `7f881e9`, `8f9a78c`, `06906ff`; migration applied live (ledger 26→27); probes 403 / 404 / 200; RSC payload `orderingEnabled` true-with-token, false-without |
| 2 | T2 #2 no email verification, weak passwords | Major | **PARTIAL** | password floor DONE (`0566dad`, 8 unit tests, 10 chars + complexity, login correctly untouched); email confirmation + CAPTCHA **declined by owner** → accepted risk documented |
| 3 | T2 #3 unauthenticated waiter/bill writes | Major | **DONE** (gated) | `52b7a6e`; probe: 403 no token, 404 wrong token; per-project 30/h budget added |
| 8 | T2 #8 /api/health leaks alert config | Minor | **DONE** | `c3e96f8`; live probe: no `integrations` key without `HEALTH_TOKEN` |
| 9 | T2 #9 vitals write amplification | Minor | **DONE** | `3b35e6e`; 240→60/min + 512-byte cap |
| 10 | T2 #10 push/subscribe unvalidated | Minor | **DONE** | `3b35e6e`; shape validation + 10/h/user |
| 4 | T2 #4 missing `order_items` index | Major | **RETRACTED** | index exists since `0006:81-82`; live query: **0 FKs without a covering index** |
| 13 | T2 #13 dead objects | Minor | **RE-SCOPED** | `order_sequences` does not exist in production (dropped); `service_requests` (0 rows) + unused routes remain → W6-T1 |
| 14 | T2 #14 default-privilege gap | Minor | **RE-SCOPED** | live `pg_default_acl` shows `postgres/public` grants only to `postgres`+`service_role` → gap already closed; only the platform setting + assertion remain → W6-T2 |

**Wave 1 exit criteria: met except the enforcement flip, which is blocked on the physical QR reprint
(W1-T8).** Until then the fix ships dark: tokenless orders are accepted, recorded
(`order_audit_logs.metadata.token_present`) and flagged to Sentry.

## Waves 2–6 — not started

| Wave | Findings | Status |
|---|---|---|
| W2 integrity/scale | T2 #5 realtime isolation, #6 middleware comment, #7 telegram 32-bit, #11 payment idempotency, #12 replay race, #14 assertion | TODO |
| W3 accessibility | T1 #1–#4, #6, #7, #13–#15, #20, #21 | TODO |
| W4 design/i18n | T1 #8–#12, #16–#19 | TODO |
| W5 SEO/headers/perf | T1 #5, #22 + CWV budget | TODO |
| W6 hardening | T2 #13 (remainder), #14, #15 | TODO |

## Live production verification (2026-10-06, read-only unless stated)

- **26/26 → 27 migrations**, `db push --dry-run` listed exactly one pending file: **no drift**.
- **21/21 public tables RLS-enabled**; **0 permissive policies**; **0 SECURITY DEFINER without a
  pinned `search_path`**; **0 function bodies using the spoofable `coalesce(auth.uid(), p_caller…)`**.
- **0 foreign keys without a covering index** (80 indexes total).
- `authenticated` holds **SELECT only** on `orders`/`order_items`; column-UPDATE limited to
  `projects`(4 cols) and `staff_members`(2 notify cols) → no role-escalation path.
- Realtime publication = `orders`, `order_items`. Cron: `expire_subscriptions` 03:00,
  `retention-sweeps` 04:10.
- Production volume is tiny — tables 2 · products 7 · orders 1 — so **this is pre-launch hardening,
  not incident response**.
- One test order was created during route verification and **deleted** (order + items + audit row);
  `orders` is back at its baseline count of 1.

## Corrections to the published audits

1. **T2 #4 retracted.** A truncated `grep … | head -80` inventory was reported as a database fact.
   Every "missing X" claim is now backed by a live query.
2. **T2 #13 partially retracted** (`order_sequences` was already dropped).
3. **T2 #14 re-scoped down** (the `postgres`-role gap was already closed).
4. Nothing else changed under live verification: T2 #8/#9/#10/#11/#12/#15 and all of Task 1 stand.

## Open blockers

| # | Blocker | Owner | Effect |
|---|---|---|---|
| 1 | **Print + place the new QR sheets** (`?k=<token>`), then set `REQUIRE_TABLE_TOKEN=true` | Ammar | The Critical stays dark until this happens |
| 2 | `bill`/`waiter`: delete or build the UI? | Ammar | Currently gated (inert), not removed |
| 3 | Hosted Auth settings: `minimum_password_length = 10`, complexity class | Ammar (dashboard) | Local config + API already enforce; GoTrue's own endpoints do not yet |
| 4 | `HEALTH_TOKEN` in Vercel + point the uptime probe at `?light=1` | Ammar | Without it `/api/health` returns liveness only (fail-safe) |
| 5 | Security/Performance Advisor output | Ammar | Could reveal something neither audit saw |
| 6 | WCAG AA contractual? | Ammar | Decides whether the axe gate is blocking or advisory (W3) |
