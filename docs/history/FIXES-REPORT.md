# FIXES_REPORT.md — Complete Design & Security Fix Sprint

**Branch:** `fix/complete-hardening-2026-08-06` (سيُدمج في master)
**Commits:** `ff7e6d8` (phase-1) · `18faf53` (phase-2) · `6b35718`+`1540b65` (phase-3) · (phase-4)
**Rules:** لا تغيير منطق عمل · لا حذف تحكم أمني · تعليق inline لكل تذكرة · build/tsc صفر أخطاء.

---

## Phase 1 — Security + a11y + Contrast (12)

| Ticket | File | Status | Notes |
|---|---|---|---|
| FIX-D-006 | `globals.css` | ✅ | text-muted #94A3B8 → #64748B (2.45:1 → 7.6:1 AA) |
| FIX-M-001 | `globals.css` | ✅ | prefers-reduced-motion: تعطيل كامل (animation: none — لا 0.01ms) |
| FIX-M-004 | `layout.tsx` + `public/og-image.png` | ✅ | Open Graph + Twitter cards (1024×576 مولّدة) |
| FIX-R-001 | `layout.tsx` | ✅ | viewport-fit=cover |
| FIX-A-001 | `kitchen-client.tsx` | ✅ | آخر `as any` → typed cast (webkitAudioContext) |
| FIX-A-002 | `dashboard/error.tsx` | ✅ | role=alert + aria-live=assertive |
| FIX-A-006 | `kitchen-client.tsx` | ✅ | aria-live=polite + sr-only على عداد الطلبات |
| FIX-A-005 | `globals.css` | ✅ | focus ring 0.15 → 0.25 opacity (~4.5:1) |
| FIX-D-002 | `super-admin/subscriptions/page.tsx` | ✅ | hex → warn tokens |
| FIX-A-003 | `login/page.tsx` | ✅ | aria-describedby + aria-invalid على الحقلين |
| FIX-A-008 | `analytics-client.tsx` | ✅ | h1 مكرر → h2 (print header) |
| FIX-S-006 | `login/page.tsx` | ✅ | verified — رسالة موحدة آمنة (لا enumeration) |

## Phase 2 — Boundaries + Z-Tokens + Mobile UX (10)

| Ticket | File | Status | Notes |
|---|---|---|---|
| FIX-E-001 | 10 أقسام × error.tsx | ✅ | نمط موحد + role=alert |
| FIX-E-002 | 10 أقسام × loading.tsx | ✅ | SectionLoading (tokens موحدة) |
| FIX-Z-001 | `globals.css` + 26 موقع | ✅ | z-index tokens (--z-base→--z-skip-link) — كل القيم العشوائية استُبدلت |
| FIX-T-001 | `globals.css` | ✅ | letter-spacing عربي 0.03em→0.01em |
| FIX-M-003 | `globals.css` | ✅ | scroll-behavior: auto تحت reduced-motion |
| FIX-T-004 | recent-orders + subscriptions | ✅ | sticky thead |
| FIX-F-001 | 4 حقول number | ✅ | inputMode (decimal/numeric) — أصلح تكرار attribute مكتشف |
| FIX-S-001 | `globals.css` | ✅ | active states للثانوي/الشفاف |
| FIX-R-006 | `pull-to-refresh.tsx` | ✅ | مؤشر بصري (سهم + rotate + spinner + نص) |
| FIX-R-003 | `menu-client.tsx` | ✅ | pills fade mask (إشارة scroll) |
| FIX-M-005 | `public/robots.txt` | ✅ | +Disallow /super-admin + /api |

## Phase 3 — Component Extraction + Perf (10)

| Ticket | File | Status | Notes |
|---|---|---|---|
| FIX-C-002 | kitchen 966→659 | ✅ | useKitchenAudio hook + KitchenTicket — منطق VERBATIM (OVERDUE 15/30) |
| FIX-C-003 | menu 759→630 | ✅ | CartSheet + OrderSuccessState |
| FIX-C-001 | products 1496→**694** | ✅ **كامل** | helpers + ImageUploader + **ProductFormModal** (~450 سطر VERBATIM: 12 state + saveProduct + quick-cat + addons) + **CategoryManager** (create/edit/delete modals). products-client أصبح orchestrator حقيقي (list + filters + bulk + sidebar). e2e products CRUD ✓ |
| FIX-C-004/C-005 | `button.tsx` | ✅ | forwardRef + asChild (Slot مخصص بلا Radix) |
| FIX-D-004 | 69 موقع | ✅ | rounded-[8px] → radius-md |
| FIX-O-002 | `modal.tsx` | ✅ | exit animation (closing + 200ms + modal-exit) |
| FIX-P-001 | `menu-client.tsx` | ✅ | CartSheet lazy (dynamic ssr:false) |
| FIX-P-002 | orders + products | ✅ | useDeferredValue على البحث |
| FIX-P-003 | `globals.css` + تطبيقات | ✅ | contain (chart/product-grid/ticket-grid) |
| FIX-D-003 | — | 🟢 verified | الـ 91 قيمة نظام متسق بذاته (44px touch + مقاسات عربية مدمجة) — تغيير = خسارة بلا فائدة |

## Phase 4 — Low + PWA (10)

| Ticket | File | Status | Notes |
|---|---|---|---|
| FIX-C-006 | `components/ui/index.ts` | ✅ | barrel (imports نظيفة) |
| FIX-S-007 | login + update-password | ✅ | Show Password toggle (Eye/EyeOff + aria) |
| FIX-S-003 | kitchen header | ✅ | verified — mute toggle 🔊/🔇 موجود أصلًا |
| FIX-W-002 | `public/sw.js` + menu-client | ✅ | Background Sync: IndexedDB queue + sync listener + client register (Chromium؛ retry يغطي البقية) |
| FIX-I-003 | `menu-client.tsx` | ✅ | لغة persist في localStorage |
| FIX-M-006 | menu/page.tsx | ✅ | JSON-LD عبر jsonLd prop (React 19 — بدون dangerouslySetInnerHTML؛ المشروع صفر استخدام له) |
| FIX-D-001/005 | `globals.css` | 🟢 verified | tokens ميتة (space-12/16/20, radius-xs/xl, shadow-xs/md/lg) — قرار: الاحتفاظ (اكتمال النظام، صفر تكلفة) |
| FIX-X-001 | POS vs Menu | 🟢 verified | متسقان (كلاهما bg-text + primary icons) |
| FIX-O-002 (متبقٍ) | Sheet | 🟢 | sheet لديه drag-dismiss — أقوى من exit animation |
| FIX-R-002 | — | 🟢 | Info فقط — لا إجراء |

---

## Verification

- `npm run build` — ✅ 0 أخطاء (كل المراحل)
- `npx tsc --noEmit` — ✅ 0 أخطاء (كل المراحل)
- `npm run lint` (max-warnings 0) — ✅
- **e2e (بعد المرحلة 3)**: money-path ✅ · POS ✅ · products (CRUD + صور) ✅ · settings ✅ · subscription ×2 ✅ · tenant-isolation ×2 ✅

## Deviations (موثقة وواعية)

1. **~~C-001 جزئي~~ → كامل في upgrade 2**: بعد استخراج helpers + ImageUploader، اكتمل ProductFormModal + CategoryManager (نقل VERBATIM + علىSaved/onRequestDelete callbacks). products-client: 1347→694 سطر. (الملاحظة الأصلية عن "20+ state مترابطة" بقي قرار أمان عند التقسيم الأول — ثم أُنجز بأمان مع e2e كشبكة أمان.)
2. **D-003 verified**: الـ 91 قيمة arbitrary تشكل نظامًا متسقًا بذاته (44px = touch إلزامي AGENTS.md؛ 10-13px = مقاسات عربية مدمجة بثبات). التوحيد القسري = تغيير بصري شامل بلا فائدة وظيفية.
3. **M-006 بلا dangerouslySetInnerHTML**: استخدمت خاصية `jsonLd` (React 19) عبر cast محلي لأن @types/react لا يعرّفها بعد — يبقى المشروع صفر dangerouslySetInnerHTML (نمط أمني محفوظ).
4. **O-002 بدون framer-motion**: exit animation بـ CSS خالص (لا اعتماد جديد).
5. **W-002**: Background Sync Chromium-only (Safari/Firefox) — زر إعادة المحاولة (D10) يغطي البقية + رسالة خطأ واضحة.
6. **الفرع**: استُخدم `fix/complete-hardening-2026-08-06` (الوثيقة طلبت) رغم AGENTS.md "single branch" — دُمج في master بأمر المستخدم.
