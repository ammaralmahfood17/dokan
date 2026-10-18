# ARCHITECTURE.md — دكان (Dokan)

معمارية النظام الحالية. صفحة واحدة تُقرأ قبل أي تغيير معماري.
**آخر تحديث: 2026-10-14** (مراجعة معمارية كاملة + موجات إعادة الهيكلة — التفاصيل في `docs/audit-2026-10/ARCHITECTURE-REVIEW-2026-10-13.md`).

> هذا الملف **محر وس آليًا**: `scripts/check-architecture-doc.mjs` يقارن جدول المسارات هنا بما هو موجود فعلًا على القرص ويفشل CI على أي فرق (مسار ناقص، مسار وهمي، أو إجمالي قديم). لا تُحرّر الجدول يدويًا بلا تشغيل السكربت.

## المكدس

```
Next.js 16 (App Router) + React 19 + TypeScript strict
Supabase: Auth (email/password) + Postgres + RLS + Realtime
Vercel (auto-deploy من master push)
Tailwind CSS v4 (tokens في @theme داخل globals.css — لا tailwind.config)
Sentry (monitoring) · Supabase RPC (rate limiting) · web-push · بوت تيليجرام · qrcode
الاختبارات: Vitest (وحدات) · Playwright (e2e، تُشغَّل يدويًا على الإنتاج) · pgTAP (قاعدة البيانات في CI)
```

## تدفق الطلب (المسار الرئيسي)

```
زبون → QR → /{projectSlug}/menu/{tableSlug} (عام، بلا تسجيل)
     → رمز الطاولة (128 بت) من الرابط
     → POST /api/public/order → requireTableToken → createSecureOrder (تسعير من الخادم)
     → RPC create_order_transactional (تحقق + ترقيم + إدراج في معاملة واحدة)
     → Realtime → لوحة الطلبات + شاشة المطبخ (KDS) → تحديث فوري
```

**مسار الكاشير (POS):** نفس الـRPC عبر `/api/pos/order`، لكن بجلسة موظف مصادق وإعادة تسعير خادمية أيضًا.

## طبقات الكود

```
src/
├── proxy.ts                      # Next.js Proxy (middleware) — جلسة Supabase + حماية المسارات
├── app/
│   ├── [projectSlug]/menu/[tableSlug]/   # القائمة العامة (QR) — تركيب فقط
│   ├── login|register|reset-password|update-password|onboarding
│   ├── dashboard/                # pos, orders, kitchen, products, tables, inventory, analytics, settings
│   ├── super-admin/              # نظرة عامة، تحليلات، اشتراكات، مستخدمون، سجل تدقيق
│   └── api/                      # 28 route handler (كلها server-side)
├── lib/
│   ├── supabase/                 # server.ts (async createClient) + client.ts + admin.ts (service role)
│   ├── api/handler.ts            # البوابة المشتركة: withSuperAdmin + readJsonBody + isUuid
│   ├── rate-limit.ts             # Supabase RPC → in-memory (fallback محلي)
│   ├── order-pricing.ts          # التسعير من الخادم (خيارات + كميات)
│   ├── menu-cart.ts              # قواعد سلة المنيو (نقية) — والـPOS يستعير منها
│   ├── pos-cart.ts               # قواعد سلة الكاشير (سقف المخزون، دمج السطر)
│   ├── order-filters.ts          # يوم البحرين + نطاقه + شرائح الطلبات + البحث والفرز
│   ├── product-form.ts           # تحقق المنتج + نداء upsert_product_with_options الواحد
│   ├── inventory.ts              # مدقّقات المخزون + التسميات + فلتر «إعادة الطلب»
│   ├── product-stock.ts          # قواعد الحصة (NULL = غير متتبَّع)
│   ├── product-options.ts        # قواعد الخيارات (مصدر واحد للمنيو والـPOS والخادم)
│   ├── dashboard-rollup.ts       # تجميع أرقام اللوحة في مرور واحد
│   ├── public-write-guard.ts     # رمز الطاولة + مفتاح التشغيل التدريجي
│   ├── push.ts / telegram.ts     # web-push + بوت تيليجرام
│   ├── database.types.ts         # أنواع Supabase المولدة (npm run db:types)
│   └── utils.ts / types.ts / i18n.ts / error-categories.ts
├── components/
│   ├── ui/                       # button, modal, toggle, empty-state, pull-to-refresh
│   ├── menu/                     # هيدر، شرائح، شبكة المنتجات، شريط السلة، نافذة الخيارات
│   ├── pos/                      # شبكة الكاشير، سلة الجوال، نافذة الخيارات، شريط التأكيد
│   └── dashboard/                # أقسام اللوحة + hooks لكل ميزة (products/, orders/, kitchen/, inventory/)
└── app/**/*-client.tsx           # تركيب: حالة + معالِجات + تركيب المكوّنات فقط
```

**القاعدة بعد الموجة 4:** كل **قاعدة** تعيش في `lib/` كدالة نقية مختبَرة، وكل **عرض** في `components/`. لا قاعدة داخل مكوّن عميل. أكبر ملف عميل اليوم ~666 سطرًا (كان 1048).

## الـAPI Routes <!-- routes: 29 -->

<!-- الجدول محروس آليًا: scripts/check-architecture-doc.mjs -->

| المسار | الغرض | مُحدَّد المعدل |
|---|---|---|
| `/api/auth/signup` | إنشاء حساب + مشروع + owner | ✅ |
| `/api/auth/callback` | تأكيد الإيميل / روابط الدخول | |
| `/api/auth/resend-confirmation` | إعادة إرسال رسالة التأكيد | ✅ |
| `/api/auth/reset-password` | إعادة تعيين كلمة المرور | ✅ |
| `/api/onboarding/project` | إعداد المشروع والعلامة (RPC معاملاتي) | ✅ |
| `/api/public/order` | طلب من QR (عام) | ✅ |
| `/api/public/order-status` | حالة طلب برقمه (uuid + انتماء) | ✅ |
| `/api/public/waiter` | «طلب موظف» (المنطق في lib/service-request) | ✅ |
| `/api/public/bill` | «طلب فاتورة» (المنطق في lib/service-request) | ✅ |
| `/api/pos/order` | طلب من الـPOS | ✅ |
| `/api/pos/cancel` | إلغاء طلب (الطريق الوحيد للإلغاء) | |
| `/api/staff/notification-prefs` | تفضيلات إشعارات الموظف | |
| `/api/revalidate-menu` | إبطال كاش القائمة بعد تعديل المنتجات | |
| `/api/push/subscribe` | تسجيل اشتراك إشعارات | ✅ |
| `/api/push/unsubscribe` | إلغاء اشتراك | |
| `/api/notifications/test` | تنبيه تجريبي لقناتي الإشعارات (عضو، 5/10 دقائق) | ✅ |
| `/api/telegram/link` | ربط/فك ربط بوت تيليجرام | |
| `/api/telegram/webhook` | مستقبل تحديثات تيليجرام (سرّي) | ✅ |
| `/api/super-admin/archive-project` | أرشفة (حذف ناعم) + سبب إلزامي | ✅ |
| `/api/super-admin/confirm-user` | تأكيد حساب يدويًا (بديل SMTP) | ✅ |
| `/api/super-admin/create-project` | إنشاء متجر لصالح تاجر (بحث الإيميل بدالة مفهرسة) | ✅ |
| `/api/super-admin/deactivate` | إيقاف فوري (إساءة/عدم دفع) | ✅ |
| `/api/super-admin/hard-delete-project` | حذف نهائي بعد 30 يومًا + تأكيد الاسم | ✅ |
| `/api/super-admin/impersonate` | بدء وضع الدعم (جلسة 30 دقيقة) | ✅ |
| `/api/super-admin/impersonate/end` | إنهاء وضع الدعم | |
| `/api/super-admin/record-payment` | تسجيل دفع يدوي + تجديد ذرّي | ✅ |
| `/api/super-admin/renew` | تجديد اشتراك | ✅ |
| `/api/health` | فحص الحياة والاعتمادية | |
| `/api/vitals` | مغناطيس Core Web Vitals | ✅ |

### البوابة المشتركة للمسارات

كل `/api/super-admin/*` يُكتب هكذا:

```ts
export const POST = withSuperAdmin('archive-project', async (request, { userId, admin }) => {
  // منطق الإجراء فقط
});
```

`withSuperAdmin` (`lib/api/handler.ts`) يملك: 401 للمستخدم الغائب → 403 لغير السوبر أدمن → الحدّ بمفتاح **معرّف المدير نفسه** → `catch` + Sentry + 500. **الترتيب عقد:** المصادقة قبل التحقق من المدخل، حتى لا يتعلّم مجهولٌ شكلَ الطلب من 400 يسبق 401.

## بوابات الكتابة العامة (غير قابلة للتفاوض)

1. **RLS على كل جدول** — العزل عبر `staff_members` + `is_project_member()`، لا `project_id` من العميل.
2. **رمز الطاولة** — الكتابة العامة تتطلب الرمز المطبوع في QR (128 بت)؛ `REQUIRE_TABLE_TOKEN` مفتاح تشغيل تدريجي.
3. **التسعير من الخادم فقط** — `orders.total_amount` محمي بـ trigger، والعميل لا يرسل مبلغًا.
4. **الكتابات متعددة الخطوات عبر RPC واحد** — `create_order_transactional`، `replace_product_recipe`، `onboard_project_transactional`، `record_payment_and_renew`، `upsert_product_with_options`. لا كتابة متعددة المراحل من المتصفح.
5. **Service role في الخادم فقط** — ودوال حساسة مقفلة على `service_role`: `next_order_number`، `rate_limit_check`، `find_user_id_by_email`.
6. Rate limiting على كل مسارات الكتابة العامة (منع السبام).

## الـRate Limiting (طبقتان)

```
1. Supabase RPC            → rate_limit_check (مسار الإنتاج الذري والمشترك)
2. in-memory Map           → آخر ملاذ محلي (per-instance، ويُنبَّه Sentry عند السقوط إليه)
```

## القياس الذي يحكم الأداء

**كل استعلام Supabase يكلّف ~150ms بصرف النظر عن شكله.** التكلفة هي **عدد الحواجز المتسلسلة**، لا عدد الاستعلامات. لذلك:

- `app/dashboard/page.tsx` يجمع 6 استعلامات في `Promise.all` واحد بعد حاجزين.
- `getCurrentProject()` يستعلم مرة واحدة (العضوية + المشروع مضمّنان).
- تُقاس أي إضافة بعدد `await` المتسلسلة قبل أول بايت، لا بعدد الاستعلامات.

## القرارات المعمارية الموثقة

| القرار | السبب |
|---|---|
| **RPC واحد لكل كتابة متعددة الخطوات** (2026-10-13) | فشل جزئي من المتصفح = بيانات تالفة بلا rollback |
| **بوابة `withSuperAdmin` مشتركة** (2026-10-13) | 8 مسارات كانت تنسخ نفس الـ28 سطرًا، و`is_super_admin` يُنادى 11 مرة |
| **تفكيك المكوّنات: القواعد إلى `lib/` أولًا ثم العرض** (2026-10-13) | القواعد صارت مختبَرة (367 اختبارًا) بلا مخاطرة بصرية في نفس الخطوة |
| **Supabase RPC لمحدد المعدل** (2026-09-28) | عداد ذري مشترك بلا Redis أو تبعية Vercel متوقفة |
| **سكواش 59 migration → baseline واحد** (2026-08-02) | إزالة 59 ملفًا متضخمًا — `0000_init.sql` من pg_dump حي |
| **إلغاء ميزة الفروع** (0041) | تبسيط — `branch_id` متروك |
| **إلغاء الطباعة 80mm** | عملاء العربات بلا طابعات — الكود محفوظ |
| **أرقام طلبات يومية** (0039/0052) | ترقيم يعيد التصفير كل يوم لكل مشروع |
| **`service_type` NULL = طلب حقيقي** | تمييز طلبات QR/POS عن طلبات النادل/الفاتورة |
| **`stock` NULL = غير متتبَّع** (0018) | كل منتج سابق للميزة بلا تغيير سلوك |

## ترقيم الـmigrations — الوضع والقاعدة

```
نمط قديم (مُتجاوَز، لا يُلمَس):   0000_init.sql … 0019_*.sql        (20 ملفًا)
النمط المعتمد منذ 2026-10-06:    YYYYMMDDHHMMSS_name.sql           (كل ما أُضيف بعدها) + 20260924… و2026…
```

**لماذا لا نُعيد التسمية؟** الملفات القديمة **مُطبَّقة على الإنتاج**، وسجلّ Supabase
(`supabase_migrations.schema_migrations`) يسجّل **النسخة** لكل ملف. إعادة التسمية تكسر التطابق بين السجل
والمستودع — وقد تجعل الأداة تظنها غير مُطبَّقة فتعيد تنفيذها. الضريبة أكبر من المكسب، فالتوحيد **للأمام فقط**،
و`scripts/check-migration-naming.mjs` يفشل CI على أي migration جديد بنمط قديم.

## الاختبارات والبوابات الآلية

```bash
npm run env:check      # عقد متغيرات البيئة (أول بوابة في CI)
npx tsc --noEmit       # أنواع
npm run lint           # eslint --max-warnings 0
npm test               # Vitest (وحدات)
npm run build          # بناء إنتاجي

node scripts/check-public-write-gates.mjs   # كل مسار service-role له بوابة موثّقة
node scripts/check-json-body-guard.mjs      # كل قراءة جسم تتحمّل JSON تالفًا
node scripts/check-touch-targets.mjs        # كل عنصر أيقوني ≥ 44px
node scripts/check-hermetic-build.mjs       # البناء لا يجلب خطوطًا من الشبكة
node scripts/check-prod-env-gate.mjs        # لا بناء إنتاجي بلا بيئته
node scripts/check-migration-naming.mjs     # لا نمط ترقيم قديم جديد
node scripts/check-architecture-doc.mjs     # هذا الملف مطابق للكود
supabase test db       # pgTAP (في CI على قاعدة فارغة)
```

## سير العمل (للمطورين والوكلاء)

- فرع واحد: `master` — commits متسلسلة، push → CI ثم Vercel auto-deploy.
- قبل الـcommit: `env:check` + `tsc` + `lint` + `test` + `build` + سكربتات الحاجز.
- أي migration جديد: **يطبَّق على الإنتاج قبل نشر الكود الذي يستدعيه** (وإلا نادى الكود دالة غير موجودة).
- تأكيد النشر: `gh api repos/…/deployments` أو حالة الـcommit (Vercel CLI غير موثوق هنا).
- للوكلاء: `AGENTS.md` هو العقد — اقرأه قبل أي تعديل.

## البيئة (Env vars)

```
NEXT_PUBLIC_SUPABASE_URL / NEXT_PUBLIC_SUPABASE_ANON_KEY
SUPABASE_SERVICE_ROLE_KEY          # server-only
NEXT_PUBLIC_VAPID_PUBLIC_KEY / VAPID_PRIVATE_KEY   # web-push
TELEGRAM_BOT_TOKEN / TELEGRAM_BOT_USERNAME / TELEGRAM_WEBHOOK_SECRET
NEXT_PUBLIC_SENTRY_DSN / SENTRY_DSN / SENTRY_ORG / SENTRY_PROJECT / SENTRY_AUTH_TOKEN
NEXT_PUBLIC_SITE_URL / HEALTH_TOKEN / DATABASE_URL
REQUIRE_TABLE_TOKEN / SIGNUP_ENABLED / TURNSTILE_SECRET / NEXT_PUBLIC_TURNSTILE_SITE_KEY
```
