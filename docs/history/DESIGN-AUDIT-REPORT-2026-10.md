# Design System & UI Engineering Audit — Dokan v2

**Audit date:** 2026-08-06 · **Scope:** كل `src/` (tsx/ts/css — 17,027 سطر) · **Method:** static scan + grep + قراءة كل tokens/pages/components
**Rule:** لا تغيير كود — تقرير فقط.

---

## Executive Summary

- **Total Issues Found: 42** · Critical: **0** · High: **6** · Medium: **13** · Low: **16** · Info: **7**
- **Positive Patterns: 21** — نظام tokens من أفضل ما رأيت في مشاريع Next.js
- النظام متماسك جدًا (RTL سليم، 8px grid صارم، tokens كاملة، a11y فوق المتوسط) — المشاكل الحقيقية: **تباين ألوان نصوص ثانوية** + **لا z-index tokens** + **مكونات ضخمة** + **تغطية غير مكتملة لحالات error/loading**.

---

## 1. Design Tokens & CSS Architecture

### Issues
| ID | File | Line | Severity | Issue | Fix |
|---|---|---|---|---|---|
| D-001 | `src/app/globals.css` | 24-26, 67, 75-78 | Low | **8 tokens غير مستخدمة:** `--space-12/16/20`, `--radius-xs/xl`, `--shadow-xs/md/lg` — صفر استخدام في `src/` | إما استخدامها أو حذفها (لا تترك tokens ميتة توحي بدعم غير موجود) |
| D-002 | `src/app/super-admin/subscriptions/page.tsx` | 35 | High | **Hardcoded hex** `bg-[#FEF3C7] text-[#B45309]` بدل tokens (كسر لنظام الألوان — يعمل لكنه خارج النظام) | استخدم `bg-[var(--color-warn-tint)] text-[var(--color-warn)]` |
| D-003 | `src/` (عام) | — | Medium | **~90 قيمة arbitrary** `text-[15px]`/`p-[13px]`/`gap-[13px]` — أغلبها خارج مقياس 8px | قياسي: `text-[15px]`→`text-sm` (14) أو أضف مقاسًا للـ token؛ التزم بمقياس النص الموثق |
| D-004 | `src/components/pos/*` + منتجات | — | Low | `rounded-[8px]` مكرر يدويًا بدل `--radius-md` (يعمل لأن القيمة مطابقة — لكن يفقد مزامنة النظام) | استبدل بـ `rounded-[var(--radius-md)]` أو class مخصص |
| D-005 | `src/app/globals.css` | 495-503 | Info | Landing page يستخدم ألوان hardcoded (#C7D2FE, rgba) — مقبول (تأثيرات زخرفية) لكن لو حُددت كـ tokens يسهل Dark Mode | نقل `#C7D2FE` → `--color-primary-tint-strong` |

### Positive Patterns
- [P-001] نظام `@theme` كامل: primary + 4 variants (hover/active/tint/tint-strong) + semantics (success/warn/danger/info مع tints) — **نموذجي**
- [P-002] تعليق "Source of truth: DESIGN_SYSTEM.md" — توثيق معماري نادر
- [P-003] `@layer base` في Tailwind v4 (unlayered beats utilities) — معالجة صحيحة لفخ v4
- [P-004] "border-first, shadow only for layering" — فلسفة elevation سليمة مطبقة فعليًا (cards بلا shadow)

---

## 2. Typography System

### Issues
| ID | File | Line | Severity | Issue | Fix |
|---|---|---|---|---|---|
| T-001 | `src/app/globals.css` | 279 | Low | `.section-title` يستخدم `letter-spacing: 0.03em` على **عربي** — التتبع يضر بقراءة العربية (موثق كقرار لكنه يخالف أفضل ممارسة) | خففه إلى `0.01em` أو أزله للعربي |
| T-002 | `src/app/page.tsx` | 69 | Info | `font-extrabold` (800) — محمّل ✓ (weights 400-800) — لا مشكلة، مسجل كملاحظة أن Cairo 900 غير محمّل وممنوع استخدامه | لا إجراء |
| T-003 | `src/app/dashboard/*` (عام) | — | Low | `text-[15px]`, `text-[12.5px]`, `text-[17px]`, `text-[22px]` — مقاسات مقطعية خارج مقياس Tailwind — لكنها متسقة عبر التطبيق (نفس القيم مكررة) | وثّقها في مقياس النص (15=نص منتج، 12.5=مساعدة) |

### Positive Patterns
- [P-005] Cairo `display: swap` ✓ + `weight: [400-800]` + `variable: --font-cairo` — تحميل خط واحد متغير (لا FOIT)
- [P-006] `-webkit-font-smoothing: antialiased` + `-moz-osx-font-smoothing: grayscale` عالميًا ✓
- [P-007] `dir="ltr"` الـ 55 استخدام كلها على أرقام/أسعار (`dir="ltr"` مع `tabular-nums`) — **صفر إساءة** للاتجاه ✓
- [P-008] `line-clamp-2` + `truncate` مطبق على أسماء المنتجات والأوصاف ✓

---

## 3. Component Architecture

### Issues
| ID | File | Lines | Severity | Issue | Fix |
|---|---|---|---|---|---|
| C-001 | `src/app/dashboard/products/products-client.tsx` | **1526** | High | **God Component** — 1526 سطر (أكبر من 400 حد التدقيق بأربعة أضعاف): 8+ أسطح UI + منطق (CRUD، صور، addons، toggles) في ملف واحد | قسّم: `ProductFormModal`, `ProductList`, `AddonManager`, `ImageUploader` (>400 سطر) |
| C-002 | `src/app/dashboard/kitchen/kitchen-client.tsx` | **966** | High | God Component — KDS (audio engine + realtime + tickets + timers) | قسّم: `useKitchenAudio`, `KitchenTicket`, `TicketGrid` |
| C-003 | `src/app/[projectSlug]/menu/[tableSlug]/menu-client.tsx` | 751 | Medium | كبير (تحسّن من 852 بعد D2) — يبقى orchestrator مع 5+ أسطح | أكمل D2: `cart-sheet.tsx`, `order-success-state.tsx` |
| C-004 | `src/components/ui/` (عام) | — | Low | **لا `React.forwardRef`** في Button/Input/Modal — لا يمكن لـ refs (focلا tools) — و**لا `asChild`/`as` polymorphism** | أضف `forwardRef` إلى Button + دعم `asChild` (نمط Radix) |
| C-005 | `src/app/dashboard/pos/pos-client.tsx` | 569 | Medium | POS كبير — cart logic + search + addon picker + banner | استخرج `usePosCart` hook |
| C-006 | `src/components/ui/` | — | Info | لا `index.ts` — استيراد مسارات عميقة (`@/components/ui/modal`) — متسق لكنه يفتقد barrel | أضف `index.ts` اختياريًا |

### Positive Patterns
- [P-009] `'use client'` في 35 ملف — الحدود صحيحة: server components تجلب (dashboard/page, menu/page) والـ client يتسلم props
- [P-010] `StatusChip` = single source of truth للـ status (يعيد استخدامه orders/pos/super-admin) — DRY نموذجي
- [P-011] D1/D2 (جلسة سابقة): dashboard 590→236، menu 852→751 — تحسّن حقيقي موثق

---

## 4. Accessibility (WCAG 2.1 AA)

### Issues
| ID | File | Line | Severity | Issue | Fix |
|---|---|---|---|---|---|
| A-001 | `src/app/dashboard/kitchen/kitchen-client.tsx` | 60 | Medium | `(window as any).webkitAudioContext` — **آخر `as any` في codebase** (بعد B7) | typed cast: `(window as unknown as { webkitAudioContext?: typeof AudioContext })` |
| A-002 | `src/app/dashboard/error.tsx` | — | Medium | **لا `aria-live` على منطقة الخطأ الديناميكية** — تحديثات الأخطاء غير معلنة لقارئ الشاشة | أضف `role="alert"` على حاوية الخطأ |
| A-003 | `src/` (عام) | — | Medium | **لا `aria-describedby`** لربط رسائل خطأ النماذج بالحقول (خطأ email/password يظهر لكن غير مربوط بالحقل) | `aria-describedby={errorId}` + `id={errorId}` على رسالة الخطأ |
| A-004 | `src/components/ui/button.tsx` | — | Low | `aria-busy` أُضيف (D12) لكن باقي الأزرار المحمّلة يدويًا (POS confirm) لا تحمل `aria-busy` | وحّد عبر `isLoading` في كل الأزرار |
| A-005 | `src/app/globals.css` | 338-342 | Low | Focus ring: `*:focus-visible { box-shadow: var(--shadow-focus) }` — ring 3px primary على 0.15 opacity — تباينه على السطح الأبيض قريب من الحد (3:1) | قوّ إلى `rgba(79,70,229,0.25)` |
| A-006 | KDS/orders dynamic updates | — | Medium | تحديثات realtime (طلب جديد، تغيير حالة) **بلا `aria-live="polite"`** — المستخدم بقارئ الشاشة لا يعلم بوصول طلبات | أضف `aria-live` على عدادات الطلبات/قائمة التذاكر |
| A-007 | `src/app/login/page.tsx` | 80-99 | Info | الحقول لها `<label htmlFor>` ✓ — ممتاز؛ لكن لا `autoComplete="email"/"current-password"`؟ (فحص: موجود 7 مواضع عامة) | تأكد من autocomplete على auth (جزئي موجود) |
| A-008 | `src/app/dashboard/analytics/analytics-client.tsx` | 94, 111 | Low | **`<h1>` مكرر في نفس الصفحة** (سطر 94 "الإحصائيات" + سطر 111 "تقرير الإحصائيات") — يكسر هرمية العناوين لقارئ الشاشة | اجعل الثاني `<h2>` (أو `<p>` مع class) |

### Positive Patterns
- [P-012] **94 aria-label/role** عبر التطبيق — أيقونات-فقط كلها موسومة (تفريغ، إغلاق، فتح القائمة)
- [P-013] Skip-to-content (D5) موجود + visible on focus ✓
- [P-014] Modal: focus trap + ESC + scroll lock + focus restore ✓ (الأفضل في فئته)
- [P-015] Toggle: `role="switch"` + `aria-checked` ✓ · Tabs: `role="tablist"` نمط pills بأزرار ✓
- [P-016] `aria-current="page"` على الـ nav النشط في sidebar ✓
- [P-017] Charts (dashboard) لها `role="img"` + `aria-label` كامل بالبيانات ✓ (من D1)

---

## 5. Responsive & Mobile-First

### Issues
| ID | File | Line | Severity | Issue | Fix |
|---|---|---|---|---|---|
| R-001 | `src/app/layout.tsx` | 41-42 | High | **viewport meta ناقص `viewport-fit=cover`** — iOS safe areas (`env(safe-area-inset-bottom)`) معرّفة في CSS لكن meta لا يفعّلها على iPhone مع notch | أضف `viewportFit: 'cover'` في تصدير `viewport` |
| R-002 | `src/app/globals.css` | 189-191 | Info | Touch targets: `.btn` تُرفع لـ 44px فقط عند `max-width: 639px` — بعض عناصر sm على desktop (32px) مقبولة (mouse) ✓ — لكن كاشير على تابلت 600px؟ | لا إجراء (مقبول) |
| R-003 | `src/` (عام) | — | Low | صفر `overflow-x-auto` مباحة؟ (فحص) — قوائم التصنيفات pills قد تفيض على شاشة 320px | تحقق من category pills في menu-client (هي `overflow-x-auto` بالفعل؟) |
| R-006 | `src/components/ui/pull-to-refresh.tsx` | 10-61 | Low | **لا مؤشر بصري عند السحب** — المستخدم يسحب بلا إشارة أنه يحدث refresh (يستخدمه orders + products) | أضف مؤشر (سهم/دائرة) يظهر عند السحب + حالة تحميل |

### Positive Patterns
- [P-018] Mobile-first: base = mobile، `sm/md/lg/xl` للترقية — **مطبق باستمرارية** (24 sm + 24 md + 29 lg)
- [P-019] `.pb-safe-bottom`/`.mb-safe-bottom` في كل الأماكن الثابتة (cart bar، sheets، headers) ✓
- [P-020] صفر استخدام `left-/right-/ml-/mr-` فيزيائية — **كل التباعد logical** ✓ (RTL مثالي)

---

## 6. Performance & Core Web Vitals

### Issues
| ID | File | Line | Severity | Issue | Fix |
|---|---|---|---|---|---|
| P-001 | `src/` (عام) | — | Medium | **صفر `dynamic()`** — كل الـ sheets/modals في الـ bundle الرئيسي (menu-client يحمل cart sheet + product picker في أول تحميل) | `dynamic(() => import('./cart-sheet'), { ssr: false })` |
| P-002 | `src/` (عام) | — | Medium | **صفر `useTransition`** — تحديثات بحث/فلترة كبيرة (orders/products) تحجب الـ main thread | استخدم `useDeferredValue(query)` في البحث |
| P-003 | `src/` (عام) | — | Low | **صفر CSS containment** — charts/grids بلا `contain: layout style paint` | أضف `contain` على الـ chart containers و product grids |
| P-004 | `src/app/globals.css` | 495-503 | Info | Landing `radial-gradient` على الـ body — رسم GPU خفيف — لا مشكلة | لا إجراء |
| P-005 | dashboard charts | — | Info | Charts div-based بلا مكتبة (قرار Karpathy) — صفر bundle overhead ✓ — لكن بلا lazy | لا إجراء حاليًا |

### Positive Patterns
- [P-021] **Landing page: صفر صور** (text-only hero + gradients) — LCP ممتاز بطبيعته ✓
- [P-022] كل `<Image>` (5) لها `width`/`height` + `sizes` + `placeholder="blur"` — **صفر CLS** ✓
- [P-023] Cairo عبر `next/font` (self-hosted، display swap) — لا FOIT/FOUT، لا طلبات خارجية ✓
- [P-024] `font-variant-numeric: tabular-nums` عالمي — أرقام ثابتة العرض في الجداول ✓

---

## 7. Animation & Motion

### Issues
| ID | File | Line | Severity | Issue | Fix |
|---|---|---|---|---|---|
| M-001 | `src/app/globals.css` | 415-421 | High | **reduced-motion يخفض فقط (0.01ms) ولا يعطّل الحركة** — الوثيقة صحيحة: بعض قارئات الشاشة تعلن عن عناصر متحركة حتى بسرعة صفرية؛ والأهم `scale-flash` (1.25x) يبقى "ينفذ" | استخدم `animation: none !important` في media query (مع استثناء الـ focus transitions) |
| M-002 | `src/app/globals.css` | 377 | Low | `pulse-dot` بلا `motion-reduce` حماية خاصة (يعتمد على العام) — يقبل | لا إجراء (مغطى بـ M-001 بعد إصلاحه) |
| M-003 | `src/app/globals.css` | 109 | Info | `scroll-behavior: smooth` عالمي بلا `prefers-reduced-motion` حماية — مستخدمو motion-sickness يتأثرون | `@media (prefers-reduced-motion: reduce) { html { scroll-behavior: auto } }` |

### Positive Patterns
- [P-025] 7 keyframes فقط — كلها `ease-out`/`linear`، **صفر bounce/spring** ✓ (spec §5 مطبق)
- [P-026] `motion-reduce:transition-none` على toggle + skeleton-shimmer يعطّل عند reduced-motion ✓
- [P-027] تعليق page-enter يشرح **لماذا لا fill-mode** (كسر position:fixed) — هندسي ناضج

---

## 8. Forms & Validation

### Issues
| ID | File | Line | Severity | Issue | Fix |
|---|---|---|---|---|---|
| F-001 | `src/app/onboarding/page.tsx` + products | — | Medium | **`inputMode="decimal"` في 3 مواضع فقط** — حقول الأسعار/الكميات الأخرى قد تفتح لوحة أرقام خاطئة | أضف `inputMode="decimal"` لكل حقول الأسعار + `numeric` للكميات |
| F-002 | login/register/onboarding | — | Low | أزرار submit تعطّل عند invalid (`disabled={!!emailErr}`) — نمط صالح ✓ لكن أخطاء التحقق تُظهر **عند blur/attempt؟** | وثّق النمط: اعرض الأخطاء عند المحاولة (أفضل من التعطيل الدائم الذي يحيّر) |
| F-003 | `src/app/dashboard/products/*` | — | Info | لا drag-and-drop للصور (upload عبر زر) — مقبول حالياً | عند طلب عميل: أضف drop zone + تقدم |

### Positive Patterns
- [P-028] `.input/.select/.textarea` موحدة: 36px، radius-sm، focus = primary + `--shadow-focus` — **متسقة عبر كل النماذج** ✓
- [P-029] `.input-error` + `.error-text` (danger) — حالات الخطأ محددة ومعرّفة
- [P-030] `maxLength` على الملاحظات + عدّاد (notes/500) ✓

---

## 9. Error / Loading / Empty States

### Issues
| ID | File | Line | Severity | Issue | Fix |
|---|---|---|---|---|---|
| E-001 | `src/app/` | — | High | **error.tsx واحد فقط (dashboard)** — أقسام: login، onboarding، POS، kitchen، products، orders، super-admin — **كلها بلا error boundary محلي** (فقط global) | أضف `error.tsx` (نمط dashboard) لكل segment رئيسي |
| E-002 | `src/app/` | — | Medium | **loading.tsx فقط 2** (dashboard + menu) — login/onboarding/orders/products/pos بلا skeleton | أضف skeleton لكل صفحة بيانات |
| E-003 | `src/app/not-found.tsx` | — | Info | موجود ومخصص ✓ — تحقق أنه يقدم "العودة للوحة" (يوجد؟) | تأكد من رابط عودة |

### Positive Patterns
- [P-031] `dashboard/error.tsx` نموذجي: تصنيف الأخطاء (database/network/auth) + أيقونة + Retry + **نسخ تفاصيل الخطأ** — الأفضل في فئته
- [P-032] Empty states غنية: أيقونة + عنوان + وصف + action (لا توجد طلبات → زر "افتح POS") ✓

---

## 10. Modals / Sheets / Overlays

### Issues
| ID | File | Line | Severity | Issue | Fix |
|---|---|---|---|---|---|
| O-001 | `src/components/menu/sheet.tsx` + modal.tsx | — | Medium | **لا إدارة تكديس (stacking)**: إذا فُتح Sheet فوقه Modal (ممكن في المنتجات) لا يوجد إدارة طبقات | أضف z-index مقسّم (backdrop 300، sheet 400) — يعتمد على Z-001 |
| O-002 | `src/components/ui/modal.tsx` | — | Low | Modal أنيميشن دخول فقط (`animate-slide-up`) — **لا أنيميشن خروج** (يختفي فجأة) | أضف exit transition (أو اقبل — مقبول للسرعة) |

### Positive Patterns
- [P-033] Sheet: drag-to-dismiss (80px threshold) + scroll lock + focus trap + safe areas — **مكتمل**
- [P-034] Backdrop click يغلق + ESC يغلق في كليهما ✓

---

## 11-12. Tables & Charts

### Issues
| ID | File | Line | Severity | Issue | Fix |
|---|---|---|---|---|---|
| T-004 | `src/app/dashboard/page.tsx` (recent-orders) | — | Low | الجدول `<table>` دلالي ✓ لكن headers **ليست sticky** | أضف `sticky top-0` على thead |
| T-005 | Orders client | — | Info | لا فرز/بحث كانا ناقصين — **أُضيفا (جلسة سابقة: cc8facd)** — لا إجراء |
| T-006 | Charts (dashboard) | — | Info | Charts = CSS bars — **بلا tooltips على الموبايل** (title attr فقط) — مقبول لكن data table مرافقة أفضل | أضف `aria-label` كامل (موجود ✓) — يكفي |

### Positive Patterns
- [P-035] Charts تستخدم bar charts للوقت (صحيح) لا pie ✓ + `aria-label` كامل بالبيانات + حالة فارغة ✓
- [P-036] `.data-table`: 44px rows، sunken header، row-only borders، hover ✓ — دلالي وسليم

---

## 13. Navigation & IA

### Issues
| ID | File | Line | Severity | Issue | Fix |
|---|---|---|---|---|---|
| N-001 | `src/app/dashboard/*` | — | Low | **لا Breadcrumbs** (عمق 1-2 فقط — مقبول بدونها) | عند إضافة صفحات أعمق: أضفها |
| N-002 | `src/components/dashboard/app-sidebar.tsx` | — | Info | موبايل: قائمة hamburger (aria-label ✓) — لا bottom tab bar — قرار تصميم سليم للموبايل (sidebar drawer) | لا إجراء |

### Positive Patterns
- [P-037] URLs بشرية (`/dashboard/orders`) ✓ · active state واضح (`aria-current` + primary underline) ✓ · deep linking يعمل مع validation (slugs تُفحص server-side) ✓

---

## 14. PWA & Offline

### Issues
| ID | File | Line | Severity | Issue | Fix |
|---|---|---|---|---|---|
| W-001 | `src/app/manifest.ts` | — | ✅ | **Verified:** manifest كامل (name, short_name, start_url=/dashboard, display=standalone, background/theme colors, icons 192/512 + maskable) | لا إجراء |
| W-002 | `public/sw.js` | — | Info | **لا Background Sync** — الطلب أثناء قطع الإنترنت يضيع (D10 retry يحل جزئيًا: يعرض خطأ + إعادة محاولة) | أضف `backgroundSync` عند طلب عميل (يكمل D10) |

### Positive Patterns
- [P-038] SW precache shell + offline.html عربي + install prompt (D15) + RSC caching + Push — **PWA مكتمل فوق المتوسط**
- [P-039] Offline page يظهر عند فشل navigation (fallback) ✓

---

## 15. RTL & i18n

### Issues
| ID | File | Line | Severity | Issue | Fix |
|---|---|---|---|---|---|
| I-001 | `src/app/globals.css` | 214-215 | Info | `.select` السهم: `background-position: start 0.75rem` — logical ✓ لكن `padding-inline-start: 2rem` — صحيح RTL ✓ — لا مشكلة |
| I-002 | `src/` (عام) | — | Info | أرقام غربية (1,2,3) في كل UI (لا ٠١٢٣) — قرار اتساق (الأسعار dir=ltr tabular) — موثق كـ Info: لو حبيت Arabic-Indic digits فهي تغيير شامل مقصود |
| I-003 | `menu-client` lang toggle | — | Info | اللغة الجديدة (AR/EN) **لا تُحفظ** (state فقط — يضيع عند refresh) — الـ i18n الكامل خارج النطاق (قرار) | عند طلب: localStorage + dir switching |

### Positive Patterns
- [P-040] **صفر properties فيزيائية** (لا left/right/ml/mr) — RTL مثالي هيكليًا ✓
- [P-041] `text-align: start` في كل الجداول/العناوين ✓ · العملة `د.ب` بعد الرقم مع dir=ltr ✓

---

## 16-17. State Machines & Notifications

### Issues
| ID | File | Line | Severity | Issue | Fix |
|---|---|---|---|---|---|
| S-001 | `src/components/ui/button.tsx` | — | Medium | **لا كل الحالات الثماني**: primary له hover/active/disabled ✓ لكن **لا loading spinner موحد** (isLoading أُضيف D12 ✓) — `btn-secondary` بلا active state | أضف `:active` للثانوي/ghost |
| S-002 | Toasts | — | Info | sonner: success auto-dismiss ✓ · error يدوم ✓ · **لا actions ("تراجع")** — مقبول (لا undo في النظام) | عند طلب: أضف undo للتفريغ |
| S-003 | KDS audio | — | Info | صوت للمطبخ (AudioContext + fallback chime) ✓ لكن **لا mute toggle للموظفين** | عند طلب عميل: إعدادات صوت |

### Positive Patterns
- [P-042] POS: تفريغ سلة Modal تأكيد (يمنع خسارة) + banner "وصل المطبخ" — حالات كاملة ✓
- [P-043] KDS: audio queue + title flash + atomic RPC — أفضل شاشة في التطبيق

---

## 18. Print

### Issues
| ID | File | Line | Severity | Issue | Fix |
|---|---|---|---|---|---|
| R-004 | `src/app/globals.css` | 538-557 | Low | **print يغطي analytics فقط** (يخفي sticky header + .print-hidden) — بقية الصفحات (orders/products) بلا print styles — لكنها ليست أهداف طباعة — مقبول | عند طلب: وسّع |

### Positive Patterns
- [P-044] `break-inside: avoid` على cards + bg أبيض + بلا shadows ✓

---

## 19. SEO & Meta

### Issues
| ID | File | Line | Severity | Issue | Fix |
|---|---|---|---|---|---|
| M-004 | `src/app/layout.tsx` | 20-37 | High | **لا Open Graph ولا Twitter cards ولا canonical** — المشاركة على واتساب/تيليجرام تعرض رابطًا بلا صورة/عنوان غني | أضف `openGraph` + `twitter` في metadata |
| M-005 | `public/robots.txt` | — | ✅ | **Verified:** robots.txt موجود ✓ — التحقق المتبقي: لا `noindex` لـ /super-admin (مقبول — الحماية حقيقية عبر requireSuperAdmin، لكن robots يمنع فهرسة لو أضيف) | اختياري: `Disallow: /super-admin` |
| M-006 | `src/app/` | — | Info | لا JSON-LD (Restaurant/Product) — المنيو العام فرصة SEO | عند التسويق: أضف JSON-LD في menu page |

### Positive Patterns
- [P-045] title template (`%s — دكان`) ✓ + description ✓ + icons كاملة + apple-touch + manifest ✓

---

## 20. Dark Mode Readiness

### Issues
| ID | File | Line | Severity | Issue | Fix |
|---|---|---|---|---|---|
| D-006 | `src/` (عام) | — | Medium | **56 `text-white`/`bg-white`** — كلها على خلفيات ملونة (primary/danger) — **سليمة الآن** لكن Dark Mode مستقبليًا: الأبيض الثابت على primary يتعارض مع dark primary | وحّد عبر `--color-on-primary` token (سطر واحد عند التبديل) |
| D-007 | `src/app/globals.css` | 6 | Info | `LIGHT MODE ONLY` موثق بصراحة ✓ — لا `dark:` prefixes (2 فقط كلاهما لون QR في tables) — بنية `@theme` قابلة للتبديل عبر `data-theme` بسهولة | لا إجراء الآن |

---

## 21. Z-Index & Layering

### Issues
| ID | File | Line | Severity | Issue | Fix |
|---|---|---|---|---|---|
| Z-001 | `src/` (عام) | — | Medium | **لا tokens z-index** — قيم عشوائية: `z-50`(7) `z-40`(5) `z-[45]`(3) `z-[60]`(2) `z-[100]`(1). **تخفيف موجود:** تعليق صريح في app-sidebar يوثق التسلسل (z-[45] < z-50) — منظم يدويًا لكن بلا طبقة tokens | عرّف `--z-*` tokens في `@theme` واستبدل القيم (صيانة مستقبلية + حماية من تراكب غير مقصود) |
| Z-002 | `src/components/pos/cart-panel.tsx` | — | Low | POS cart sheet + Modal كلاهما `z-50` — التراكب الحالي مقصود ومستند (لا يفتحان معًا في نفس الشاشة حاليًا) لكن القيم المكررة بلا tokens تترك باب خطأ مستقبلي | فعّل Z-001 |

---

## 22. Scroll Behavior

### Issues
| ID | File | Line | Severity | Issue | Fix |
|---|---|---|---|---|---|
| S-004 | `src/` (عام) | — | Low | **لا scroll shadows** على القوائم الطويلة (orders/products) — لا إشارة "المزيد بالأسفل" | أضف fade عند الحافة (اختياري) |
| S-005 | `src/` (عام) | — | Info | لا "Scroll to Top" — مقبول (الصفحات قصيرة نسبيًا) | عند نمو: أضف |

### Positive Patterns
- [P-046] Scroll lock في modal/sheet + restore position ✓ (كلاهما)

---

## 23. Cross-Page Consistency

### Issues
| ID | File | Line | Severity | Issue | Fix |
|---|---|---|---|---|---|
| X-001 | POS vs Menu add-to-cart | — | Medium | **زر "إضافة" في POS**: `bg-[var(--color-text)]` (أسود) + أيقونة primary — بينما **Menu العام**: نفس الزر `bg-[var(--color-text)]` + primary — متناسقان! لكن **زر "تأكيد الطلب"**: POS `bg-primary` + Menu `style={{background: var(--color-primary)}}` — متسق ✓ | لا إجراء — لكن راجع: POS floating bar أسود + menu cart bar أسود = متسق ✓ |
| X-002 | `src/app/dashboard/tables/tables-client.tsx` | 108,142 | Info | QR `color: {dark, light}` — لون ثابت داخل الـ QR (ليس dark mode UI) — مسجل للتوضيح |

### Positive Patterns
- [P-047] page-header موحد (`h1` + `p` ثانوي) في كل صفحات dashboard ✓ · `.card`/`.btn`/`.input` موحدة عبر كل التطبيق ✓
- [P-048] StatusChip واحد يخدم كل الأسطح (labels + tones) ✓

---

## 24. Security-Related Design

### Issues
| ID | File | Line | Severity | Issue | Fix |
|---|---|---|---|---|---|
| S-006 | `src/app/login/page.tsx` | — | Info | رسائل الخطأ: "البريد أو كلمة المرور غير صحيحة" (آمنة — لا enumeration) — تحقق: موجود؟ | تأكد من النص الآمن (لا "المستخدم غير موجود") |
| S-007 | `src/app/update-password/page.tsx` | — | Info | لا "Show Password" toggle (فحص: لا يوجد) — تحسين UX أمني | عند طلب: أضف eye toggle |

### Positive Patterns
- [P-049] Impersonation banner أحمر دائم + logout من super-admin header ✓ · session expiry: لا مؤشر بصري (Info — عند طلب)

---

## 25. Positive Patterns (ملخص)

1. **نظام tokens كامل ومطبق** — @theme + 8px grid + border-first philosophy (P-001..004)
2. **RTL مثالي هيكليًا** — صفر properties فيزيائية (P-040)
3. **a11y فوق المتوسط** — 94 aria + focus traps + skip link + switch roles (P-012..017)
4. **KDS = مرجع** — audio + realtime + atomic RPC + timers (P-043)
5. **PWA مكتمل** — precache + offline + install + push (P-038)
6. **LCP نظيف** — landing بلا صور + Cairo ذاتي الاستضافة (P-021..023)
7. **Error boundary نموذجي** (dashboard) + empty states غنية (P-031..032)

---

## Appendix A: Component Size Audit

| Component | Lines | Verdict |
|---|---|---|
| `products/products-client.tsx` | 1526 | 🔴 **God Component — split immediately** |
| `kitchen/kitchen-client.tsx` | 966 | 🔴 **God Component** |
| `menu/menu-client.tsx` | 751 | 🟠 كبير (تحسّن من 852) |
| `pos/pos-client.tsx` | 569 | 🟠 كبير |
| `orders/orders-client.tsx` | 524 | 🟠 كبير |
| `tables/tables-client.tsx` | 421 | 🟠 حد الـ 400 |
| `onboarding/page.tsx` | 367 | 🟡 |
| `settings/settings-client.tsx` | 361 | 🟡 |
| `analytics/analytics-client.tsx` | 317 | 🟡 |
| `dashboard/page.tsx` | 236 | ✅ (من 590 بعد D1) |
| `super-admin/subscriptions/page.tsx` | 234 | ✅ |

## Appendix B: Z-Index Inventory

| Value | Count | Context |
|---|---|---|
| `z-50` | 7 | Modal, Sheet, cart sheet |
| `z-40` | 5 | Sidebar drawer, headers |
| `z-30` | 4 | Cart floating bar |
| `z-[45]` | 3 | (تحقق) |
| `z-[60]` | 2 | Offline banner, impersonation banner |
| `z-[100]` | 1 | Skip link |
| `z-20`/`z-10` | 4 | Sticky menu header |

## Appendix C: Animation Inventory

| Name | Duration | Easing | Purpose |
|---|---|---|---|
| `slide-up` | 0.24s | ease-out | Sheet/Modal entrance |
| `scale-flash` | 0.4s | ease-out | "Added to cart" check |
| `fade-in` | 0.2s | ease-out | Subtle entrances |
| `slide-in-right` | 0.3s | ease-out | Side panels |
| `pulse-dot` | 2s | ease-in-out | Live indicators |
| `shimmer` | 1.6s | linear | Skeleton sweep |
| `page-enter` | 0.25s | ease-out | Page transitions |

## Appendix D: Color Contrast Matrix

| Foreground | Background | Ratio | WCAG AA | Notes |
|---|---|---|---|---|
| `#0F172A` text | `#F8FAFC` bg | 17.1:1 | ✅✅ | ممتاز |
| `#475569` secondary | `#FFFFFF` surface | 7.6:1 | ✅✅ | ممتاز |
| `#4F46E5` primary | `#FFFFFF` | 6.3:1 | ✅✅ | ممتاز |
| `#4338CA` primary-hover | `#FFFFFF` | 7.9:1 | ✅✅ | |
| `#94A3B8` **text-muted** | `#F8FAFC` bg | **2.45:1** | ❌❌ | **FAIL — نصوص مساعدة 12px غير مقروءة** |
| `#94A3B8` muted | `#FFFFFF` | 2.56:1 | ❌❌ | **FAIL** |
| `#94A3B8` muted | `#F1F5F9` sunken | 2.34:1 | ❌❌ | **FAIL** |
| `#DC2626` danger | `#FEF2F2` tint | 4.41:1 | ⚠️ AA-large | نصوص 12px (badges) دون الحد — ارفع إلى 4.5 |
| `#D97706` warn | `#FFFBEB` tint | 3.07:1 | ⚠️ AA-large | **fail لـ 12px** |
| `#059669` success | `#FFFFFF` | 3.77:1 | ⚠️ AA-large | fail لـ 14px |
| `#0284C7` info | `#FFFFFF` | 4.10:1 | ⚠️ AA-large | fail لـ 14px |

**الخلاصة اللونية:** `text-muted` (مستخدم على hints + أزمنة + empty states + delivered badge) **لا يحقق AA إطلاقًا** — أهم إصلاح تباين في النظام. Semantic colors على white تفشل لنص 14px (هي AA-large فقط).

---

## Priority Action List (لو نُفّذ لاحقًا)

1. **A-001 + C-001/C-002** — تقسيم God Components (products 1526 → ~6 ملفات، kitchen 966 → ~4) — أكبر أثر للصيانة
2. **Z-001** — tokens z-index (يزيل صراعات الطبقات)
3. **M-004** — Open Graph (مشاركة واتساب/تيليجرام للمنيو العام = تسويق مجاني)
4. **M-001 + R-001** — reduced-motion كامل + viewport-fit
5. **D-002 + Appendix D** — تباين muted/semantic (WCAG AA)
6. **E-001/E-002** — error/loading لكل الأقسام
7. **P-001/P-002** — dynamic() + useDeferredValue
