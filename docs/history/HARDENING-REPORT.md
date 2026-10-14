# HARDENING_REPORT.md — Security + Design Hardening Sprint

**Branch:** `security-design-hardening-2026-08-06`
**Date:** 2026-08-06
**Rules followed:** لا تغيير في منطق العمل / لا حذف تحكم أمني / تعليق inline لكل تذكرة / build + tsc صفر regressions.

---

## Ticket Summary

| Ticket | File(s) | Severity | Description | Status |
|---|---|---|---|---|
| **B1** | `src/app/api/pos/order/route.ts`, `src/app/api/pos/cancel/route.ts` | Critical | POS/cancel routes verified the JWT via local `getSession()` only — a fired staff member's unexpired-but-revoked token stayed valid. Both now force a server-side `getUser()` verification before any mutation. (Other mutation routes — notification-prefs, push/subscribe, telegram/link, revalidate-menu — already used `getUser()`.) | ✅ Applied |
| **B2** | `src/app/api/pos/order/route.ts` | Critical | POS order route did NOT check `is_active`/subscription — an owner could keep taking orders through the register after their store was deactivated/expired. Now gates on the same `is_project_publicly_available()` RPC the public API uses (403 + Arabic message). | ✅ Applied |
| **B3** | `src/app/api/public/waiter/route.ts` | High | Waiter route already had a per-(table+IP) limit (8/min). Added a second, global per-IP limit (20/min) so one IP can't fan out across many tables in the same minute. | ✅ Applied |
| **B4** | `supabase/migrations/0020_rate_limits_lockdown.sql` | Critical | `rate_limits` was `GRANT ALL TO anon, authenticated` — anyone could read all stores' rate-limit keys, wipe anti-spam counters, or inject fake records. REVOKEd from anon/authenticated; service_role only. **Verified live:** anon read → `permission denied`. | ✅ Applied |
| **B5** | `supabase/migrations/0001_security_hardening.sql` | Verify | `REVOKE ALL ON FUNCTION public.is_super_admin() FROM anon;` | ✅ Verified — anon cannot call `is_super_admin()` |
| **B6** | `src/app/api/onboarding/project/route.ts` | High | Project creation had no rate limit — automated free-trial abuse possible. Added 3 projects/hour per user (429). | ✅ Applied |
| **B7** | `src/lib/push.ts`, `src/lib/telegram.ts` | Medium | `createAdminClient() as any` removed; web-push error narrowed through `unknown` with a typed shape (no `as any` anywhere in lib/). | ✅ Applied |
| **B8** | `src/lib/utils.ts` | High | `generateQrToken()` fallback used `Math.random()` (predictable → forgeable table QR links). Replaced with CSPRNG `crypto.getRandomValues`. | ✅ Applied |
| **B9** | `supabase/migrations/0000_baseline_consolidated.sql` | Verify | `orders_protect_amounts` trigger blocks total_amount/order_number mutation after insert. | ✅ Verified |
| **B10** | `supabase/migrations/0010_advance_order_status_and_rpc_guards.sql` | Verify | `create_order_transactional` RPC = atomic order + line items. | ✅ Verified |
| **B11** | `supabase/migrations/0012_subscription_enforcement.sql` | Verify | `expire_subscriptions()` + pg_cron 03:00 daily = hard subscription cutoff. | ✅ Verified |
| **D1** | `src/app/dashboard/page.tsx` → `src/components/dashboard/*` + `src/lib/dashboard-data.ts` | Medium | God component split: KpiCards, ChecklistSection, HourlySalesChart, RecentOrdersTable, WeeklySalesChart, TopProducts + pure data helpers. page.tsx: 590 → 236 lines. | ✅ Applied |
| **D2** | `src/app/[projectSlug]/menu/[tableSlug]/menu-client.tsx` → `src/components/menu/*` | Medium | Extracted bottom-sheet (`Sheet`) + product row (`MenuProductRow`) into `src/components/menu/`. menu-client: 852 → 717 lines. | ✅ Applied |
| **D3** | `src/components/ui/modal.tsx` | Low | Modal already had role/aria-modal — upgraded to `aria-labelledby` + `useId` (no Math.random id). | ✅ Applied |
| **D4** | `src/components/menu/product-card.tsx` | Low | Product cards are native `<button>` (keyboard + 44px target) — compliant already. | ✅ Verified |
| **D5** | `src/app/layout.tsx` | Low | Skip-to-content link added (sr-only → visible on focus). | ✅ Applied |
| **D6** | `src/components/ui/toggle.tsx` | Low | Toggle already had `role="switch"` + `aria-checked` + aria-label + focus-visible ring. | ✅ Verified |
| **D7** | `src/components/ui/offline-banner.tsx` + menu-client | Low | Offline banner (slim, non-blocking) on the customer menu via online/offline events. | ✅ Applied |
| **D9** | `src/components/ui/skeleton.tsx` (MenuSkeleton) + `[tableSlug]/loading.tsx` | Low | Menu skeleton (header + pills + 6 rows), same tokens as DashboardSkeleton. | ✅ Applied |
| **D10** | `menu-client.tsx` (placeOrder) | Medium | Persistent order-error block + "إعادة المحاولة" button (toast alone vanished before). | ✅ Applied |
| **D12** | `src/components/ui/button.tsx` | Low | `isLoading` prop: built-in spinner + auto-disable + `aria-busy` (prevents double-clicks). | ✅ Applied |
| **D14** | `public/offline.html` | Low | Already implemented as a static SW-cached page (better than an app route — works with JS disabled). | ✅ Verified |
| **D15** | `src/components/ui/install-prompt.tsx` + layout | Low | Add-to-Homescreen prompt (beforeinstallprompt) with dismiss. | ✅ Applied |
| **F1** | `next.config.ts` | High | **CSP added** — default-src 'self'; Google Fonts (Cairo) + Supabase API/WS + Sentry allowed; `frame-ancestors 'none'`. | ✅ Applied |
| **F4** | deactivate / renew / archive / admin renew-subscription routes | Medium | `revalidateTag('menu-<id>', 'max')` after every is_active/subscription mutation — public menu cut/restored immediately (no 60s cache window). | ✅ Applied |

---

## Verification Results

- `npm run build` — ✅ Compiled successfully, 0 errors
- `npx tsc --noEmit` — ✅ 0 errors
- `npm run lint` (max-warnings 0) — ✅ clean
- B4 live check — anon read of `rate_limits` → `permission denied for table rate_limits` ✅

## Notes / Deviations (documented, intentional)

1. **B3**: the ticket claimed the waiter route had *no* rate limiting — it already had an 8/min per-(table+IP) limit. Added the missing per-IP cap rather than duplicating.
2. **B5 file reference**: the ticket referenced `0001_security_hardening.sql` — exists (line 133 has the REVOKE). Verified in place.
3. **D14**: `public/offline.html` pre-existed and is SW-precached — kept over an `src/app/offline` route (works without JS; the SW already falls back to it on navigation failures).
4. **D4/D6**: already compliant — recorded as verified instead of re-implementing.
5. **Migration numbering**: B4 uses `0020_` because `0019_subscription_cutoff_hard.sql` (subscription cutoff RPC, previous hardening) already occupies 0019.
6. **B1 note**: `getUser()` re-added to POS routes adds ~200-800ms on order/cancel — accepted security cost per the audit ticket (authz correctness over latency on money-mutating routes).
