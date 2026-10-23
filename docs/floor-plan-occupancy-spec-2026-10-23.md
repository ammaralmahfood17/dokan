# مخطط الصالة وحالة الطاولات — مواصفة تنفيذ
**التاريخ:** 2026-10-23 · **الأساس:** `master` @ `41d4c73` · **الحالة:** مواصفة معتمدة، لم يُكتب كود بعد

## 1. القرارات المثبتة (من المالك)

| # | القرار |
|---|---|
| 1 | إغلاق الطاولة: **المالك أو أي موظف** من أعضاء المتجر (الدورات: owner / manager / staff). شاشة المطبخ قراءة فقط. |
| 2 | طاولة فيها طلبات نشطة: **تحذير + سبب إلزامي**، لا منع مطلق. |
| 3 | المجموع = **كل الجلسة**، مع فصل مدفوع / غير مدفوع. |
| 4 | حالة ثالثة **«بانتظار الفاتورة»** تلقائيًا عند طلب الفاتورة. |
| 5 | جلسة مفتوحة 8 ساعات: **إغلاق تلقائي** بعلامة «أُغلقت آليًا». |

## 2. لماذا جلسة وليس حالة مشتقة

النسخة المؤرشفة (`backup/before-reset-2026-10-16`) تحسب الانشغال من الطلبات النشطة
(`status in pending/preparing/ready`). هذا يخالف القرار 1: أول «تم التسليم» تُفرغ الطاولة بلا موظف.
لذلك مصدر الحقيقة يصبح صفًّا صريحًا: **جلسة طاولة**. «مشغولة» = توجد جلسة `closed_at IS NULL`.

## 3. نموذج البيانات

### 3.1 استعادة أعمدة المخطط (لا كتابة جديدة)
```bash
git show backup/before-reset-2026-10-16:supabase/migrations/20261013100000_table_floor_layout.sql \
  > supabase/migrations/20261013100000_table_floor_layout.sql
```
تضيف `tables.pos_x, pos_y` (شبكة 0..1000 مجرّدة)، `seats`, `zone` — كلها NULLABLE وNULL = «غير موضوع».
تُطبَّق قبل أي شيء (تغيير غير مرئي على الشاشة حتى يسحب المالك طاولة).

### 3.2 جدول الجلسات
```sql
create table public.table_sessions (
  id uuid primary key default gen_random_uuid(),
  project_id uuid not null references public.projects(id) on delete cascade,
  table_id uuid not null references public.tables(id) on delete restrict,
  opened_at timestamptz not null default now(),
  opened_by uuid references auth.users(id),      -- NULL = فتحها زبون عبر QR
  closed_at timestamptz,
  closed_by uuid references auth.users(id),      -- NULL + closed_at = إغلاق آلي
  close_reason text,
  closed_automatically boolean not null default false,
  bill_requested_at timestamptz,
  constraint table_sessions_reason_len check (close_reason is null or char_length(btrim(close_reason)) between 3 and 200),
  constraint table_sessions_closed_pair check ((closed_at is null) = (closed_automatically = false and closed_by is null and close_reason is null))
);
create unique index table_sessions_one_open on public.table_sessions(table_id) where closed_at is null;
create index table_sessions_project_open on public.table_sessions(project_id, closed_at);
```
**الفهرس الفريد الجزئي هو الضمانة كلها** — لا يمكن وجود جلستين مفتوحتين على طاولة، حتى مع طلبين متزامنين.

### 3.3 تعديلات على الطلبات
```sql
alter table public.orders
  add column session_id uuid references public.table_sessions(id) on delete set null,
  add column paid_at timestamptz;
create index orders_session on public.orders(session_id) where session_id is not null;
create index orders_session_unpaid on public.orders(session_id) where paid_at is null;
```

> **تنبيه مالي:** لا يوجد اليوم أي تتبّع دفع على `orders` (الموجود `subscription_payments` فقط).
> القرار 3 يفرض إضافة `paid_at`، أي مسار كتابة مالي جديد. يُكتب عبر RPC فقط (لا UPDATE مباشر)،
> ويُقيَّد بـ`paid_at is null` حتى يكون idempotent، ويُسجَّل في `order_audit_logs` بحدث `payment_collected`.

## 4. الثوابت (تُختبر، لا تُفترض)

1. جلسة مفتوحة واحدة لكل طاولة (فهرس فريد).
2. `session.project_id` = `orders.project_id` لكل طلب مرتبط.
3. `orders.table_id` = `session.table_id` عند الربط (trigger تحقق، لا trust من العميل).
4. `close_reason` إلزامي عند الإغلاق القسري بطلبات نشطة.
5. الإغلاق idempotent: استدعاء ثانٍ يرجع الجلسة كما هي بلا تغيير.

## 5. الـRPCs

| الدالة | الصلاحية | السلوك |
|---|---|---|
| `ensure_table_session(p_project_id, p_table_id, p_actor)` | service_role (تُستدعى من `create_order_transactional` فقط) | `insert … on conflict (table_id) where closed_at is null do nothing`, ثم `select` الجلسة المفتوحة. تحبس صف الطاولة `for update` أولًا. |
| `close_table_session(p_session uuid, p_reason text, p_force boolean)` | authenticated + عضو في المشروع | يعيد عدد الطلبات النشطة؛ إن >0 وليس force ⇒ `raise TABLE_HAS_ACTIVE_ORDERS`. إن force وبلا سبب ⇒ `REASON_REQUIRED`. |
| `collect_table_session(p_session uuid)` | authenticated + عضو | يضع `paid_at = now()` لكل طلب غير مدفوع وغير ملغى في الجلسة؛ يرجع (مدفوع، غير مدفوع، عدد). |
| `table_board(p_project uuid)` | authenticated + عضو | صف واحد لكل طاولة: الحالة، وقت الفتح، الطلبات، الإجمالي، المدفوع، غير المدفوع. مصدر الشاشات كلها. |
| `auto_close_stale_sessions()` | pg_cron كل ساعة | تُغلق ما `opened_at < now() - interval '8 hours'` بـ`closed_automatically = true`، وتترك الطلبات كما هي. |

كل الدوال `security definer` مع `set search_path = public, pg_temp` و`revoke all from public` ثم
`grant execute` للدور المناسب — نفس نمط بقية الـRPCs في المشروع.

**نقطة الاختناق:** الربط يحدث داخل `create_order_transactional` (0000_init) لأنها المسار الوحيد
المشترك بين طلب QR وطلب POS (كلاهما service_role). لا تُكرَّر المنطقية في الـroutes.

### 5.1 استثناءات صريحة
- `orders.service_type in ('waiter','bill')`: لا تفتح جلسة، ولا تُحسب في المجموع.
- طلب `bill` داخل جلسة مفتوحة: `bill_requested_at = now()` ⇒ الحالة الثالثة.
- طلب ملغى: يبقى في الجلسة لكن خارج المجموع.

## 6. حساب الأرقام (SQL واحد، لا جمع في JS)
```sql
select
  count(*) filter (where status <> 'cancelled')                          as orders_count,
  coalesce(sum(total_amount) filter (where status <> 'cancelled'), 0)    as total,
  coalesce(sum(total_amount) filter (where paid_at is not null and status <> 'cancelled'), 0) as paid,
  coalesce(sum(total_amount) filter (where paid_at is null and status <> 'cancelled'), 0)     as unpaid,
  count(*) filter (where status in ('pending','preparing','ready'))      as active_orders
from public.orders
where session_id = $1 and service_type is null;
```
`numeric(10,3)` كما هي؛ لا `float`، ولا `toLocaleString` بلا قفل على `ar-BH`.

## 7. Realtime
- إضافة `table_sessions` إلى `supabase_realtime` بـDO block idempotent (نفس نمط `orders`).
- RLS: `select` لأعضاء المشروع فقط؛ `anon` لا يرى شيئًا.
- الشاشات تشترك في `table_sessions` + `orders`، وتعيد نداء `table_board` بعد debounce 300ms — لا جمع في المتصفح.
- المطبخ يشترك أيضًا لكن أزراره معطّلة (قراءة فقط).

## 8. الواجهات

**`/dashboard/tables`** — تبويب «الطاولات | مخطط الصالة» (مستعاد من الأرشيف: سحب وإفلات، تصدير PNG، مدة الانشغال).
بطاقة الطاولة تعرض: الرقم، المقاعد، **الحالة**، مدة الانشغال `mm`، الإجمالي، غير المدفوع.
الألوان: فاضية = سطح أبيض بحد رمادي؛ مشغولة = `primary-tint` + حد `primary`؛ بانتظار الفاتورة = `warn-tint` + حد `warn`.

**لوحة الجلسة** (Drawer عند النقر): قائمة الطلبات (رقم، وقت، حالة، مبلغ، زر «مدفوع»)، ملخص
(الإجمالي/المدفوع/غير المدفوع)، أزرار: «تحصيل الكل» و«إغلاق الطاولة».
الإغلاق مع طلبات نشطة ⇒ مودال تحذير: «N طلبات لم تُسلَّم» + حقل سبب إلزامي (3–200 حرف).

**المطبخ** — شريط أعلى اللوحة: «طاولات مشغولة N · إجمالي X» + فلتر بالطاولة يعرض مجموع جلستها.
لا زر إغلاق ولا تحصيل في شاشة المطبخ.

**POS** — منتقي الطاولة يعرض حالة كل طاولة ومجموعها؛ اختيار طاولة مشغولة يضيف للجلسة نفسها (لا يفتح ثانية).

## 9. الحالات الحدّية والمزالق

1. **مسحان متزامنان** لنفس الطاولة: الفهرس الفريد + `on conflict`؛ لا `select` ثم `insert`.
2. **POS أوفلاين**: الإعادة تحمل نفس `clientRequestId` ⇒ الطلب موجود ⇒ لا جلسة ثانية (تحقق `orders.session_id` قبل الربط).
3. **طلب بعد الإغلاق** (تاب قديم مفتوح): يفتح جلسة جديدة — سلوك صحيح ومقصود.
4. **حذف طاولة وجلستها مفتوحة**: `on delete restrict` ⇒ الواجهة تطلب الإغلاق أولًا.
5. **إغلاق آلي وطلبات نشطة**: تُغلق الجلسة ولا تُلغى الطلبات؛ تبقى على لوحة المطبخ. علامة «أُغلقت آليًا» ظاهرة في سجل الجلسة.
6. **إعادة فتح بعد التحصيل**: «تحصيل الكل» لا يغلق الجلسة؛ الإغلاق فعل منفصل (قرار 2).
7. **المبالغ**: التحصيل يقيّد بـ`paid_at is null`؛ استدعاء مكرر لا يضاعف شيئًا.

## 10. الاختبارات

**pgTAP** (`supabase/tests/phase_table_sessions.sql`):
- جلستان متزامنتان ⇒ الثانية تُرفض بالفهرس.
- عضو من متجر آخر يحاول الإغلاق ⇒ `NOT_AUTHORIZED`.
- إغلاق بطلبات نشطة بلا `force` ⇒ خطأ بالعدد.
- `force` بلا سبب ⇒ `REASON_REQUIRED`.
- إغلاق مكرر ⇒ نفس `closed_at`.
- `table_board` تستثني الملغى و`service_type`، وتفصل المدفوع.
- `auto_close_stale_sessions` تُغلق 8h+ فقط، ومرتين لا تغيّر شيئًا.

**Vitest:** آلة الحالة (فاضية/مشغولة/بانتظار الفاتورة) وتنسيق المبالغ.

**e2e (بمستأجر اختباري):** طلب QR ⇒ مشغولة؛ طلب ثانٍ ⇒ المجموع = مجموع الاثنين؛ طلب فاتورة ⇒
بانتظار الفاتورة؛ إغلاق بلا سبب مع طلبات نشطة ⇒ مرفوض؛ بسبب ⇒ فاضية؛ طلب جديد ⇒ جلسة جديدة.

## 11. المراحل
- **A — البيانات (1.5 يوم):** migration الأعمدة + الجلسات + `orders.session_id/paid_at`، الدوال الخمس، pgTAP، تطبيق على الإنتاج بموافقة.
- **B — الشاشة (2 يوم):** استعادة مخطط الصالة من الأرشيف + الحالات + لوحة الجلسة + الإغلاق/التحصيل.
- **C — المطبخ وPOS (1 يوم):** `table_board` + realtime + شريط المطبخ + منتَقي POS.
- **D — الأتمتة (0.5 يوم):** pg_cron كل ساعة + لافتة «أُغلق آليًا» + توثيق.

## 12. مخاطر
- **استعادة الأرشيف:** تُقرأ من الفرع ثم تُقارن بـ`master` — المكوّن هناك يحسب الانشغال من الطلبات، وهذا الجزء يُستبدل لا يُنسخ.
- **`paid_at` مسار مالي جديد:** بلا RPC محصّن يصبح المبلغ قابلًا للتلاعب من العميل؛ RLS تمنع UPDATE المباشر على `orders` اليوم، ويجب أن تبقى كذلك.
- **حمل realtime:** كل تغيير طلب يوقظ كل الشاشات؛ الـdebounce و`table_board` شرطان لا تحسينان.

---

## 13. سجل التنفيذ — المرحلة B (نُفِّذت 2026-10-23)

**الحالة:** مكتملة محليًا، غير منشورة (تحتاج push).

| ما تُنفِّذ | الملف |
|---|---|
| قواعد العرض النقية: الحالة الثلاثية، مدة الانشغال، سطر الشريحة | `src/lib/floor-plan.ts` + 14 اختبارًا |
| مخطط الصالة (سحب وإفلات، أسهم، ترتيب تلقائي، حالات ملوّنة) | `src/components/dashboard/floor-plan.tsx` |
| لوحة الجلسة: طلبات، إجمالي/مدفوع/غير مدفوع، تحصيل، إغلاق بسبب إلزامي | `src/components/dashboard/table-session-drawer.tsx` |
| تبديل «مخطط الصالة / الطاولات و QR»، realtime عبر `table_board` | `tables-client.tsx` |
| `table_board()` بدل حساب الطلبات النشطة + دور staff مسموح | `tables/page.tsx` |

**قرار تنفيذي جديد:** `/dashboard/tables` كانت `owner/manager` فقط، والقرار 1 يقول «أي موظف».
صارت متاحة لدور `staff` مع إخفاء إدارة الطاولات وQR (إنشاء/حذف/طباعة/روابط)؛ المخطط وإغلاق
الجلسة متاحان. مُتحقَّق: حساب staff شاهد 4 طاولات و**صفر** زر «طاولة جديدة».

**عيب حقيقي كشفه التحقق:** اشتراط «أي حركة = سحب» منع فتح الطاولة بالنقر (اهتزاز الإصبع
بكسل واحد كان يلغي النقرة). صار حدّ السحب 4 نقاط.

**التحقق الحيّ (بناء إنتاجي محلي + مستأجر مؤقت):**
4 طاولات → طلب 1.350 ⇒ «مشغولة» → طلب ثانٍ 0.900 ⇒ الإجمالي **2.250** وطلبان في اللوحة →
إغلاق مع طلبين نشطين ⇒ تحذير + سبب إلزامي ⇒ أُغلق بـ`closed_by` والسبب محفوظ ⇒ «متاحة».
الهاتف 390: بلا تمرير أفقي. صفر أخطاء console. البيانات المؤقتة حُذفت.

**حدود أُغلقت لاحقًا (2026-10-23):** تصدير PNG استُعيد؛ التحصيل لكل طلب أُضيف
(`mark_order_paid`)؛ شريط المطبخ ومنتقي POS نُفِّذا في المرحلة C.

---

## 14. سجل التنفيذ — المرحلة C (نُفِّذت 2026-10-23)

**الحالة:** مكتملة محليًا، غير منشورة.

| ما تُنفِّذ | الملف |
|---|---|
| POS يقبل طاولة: تحقق أنها للمتجر ونشطة، وإجبار النوع `dinein` | `src/app/api/pos/order/route.ts` |
| `tableId` في عقد الإرسال والطابور الأوفلاين | `src/lib/pos-submit.ts` · `pos-offline-queue.ts` |
| منتقي طاولات في POS: متاحة/مشغولة + إجمالي الجلسة + «ستفتح جلسة جديدة» | `pos-client.tsx` · `pos/page.tsx` |
| شريط «الصالة» في المطبخ: عدد المشغول + الإجمالي + فلترة بالطاولة، **قراءة فقط** | `kitchen-tables-strip.tsx` · `kitchen-client.tsx` |

**التحقق الحيّ (بناء إنتاجي محلي + مستأجر مؤقت):**
`POST /api/pos/order` بـ`tableId` ⇒ 200، والطلب في القاعدة بـ`table_id` و`session_id` وإجمالي **0.400**
(2 × 0.200). POS أظهر الشريحة «01 · 0.400 BHD» و«مفتوحة — الإجمالي 0.400 BHD». شريط المطبخ ظهر
«1 مشغولة · 0.400 BHD» مع شريحة الطاولة، و**صفر** أزرار إغلاق/تحصيل. صفر أخطاء صفحة، والبيانات حُذفت.

**قرارات تنفيذية:**
- اختيار «سفري/سيارة» يمسح الطاولة المختارة — وإلا انضم بيع سفري لجلسة مفتوحة.
- الطاولة اختيارية داخل «طاولة» (طلب على الكاشير بلا طاولة يبقى ممكنًا ولا يفتح جلسة).
- شريط المطبخ يبقى ظاهرًا أثناء الفلترة حتى لو أُغلقت كل الطاولات، وإلا بقي الفلتر يخفي التذاكر بلا زر مسح.

**حدود معلنة:** لا إغلاق/تحصيل من المطبخ (قرار 1)؛ لا تصدير PNG؛ لا تبديل دفع لكل طلب.


---

## 15. سجل الإغلاق — متبقيات A/B/C (2026-10-23)

| البند | التنفيذ | التحقق |
|---|---|---|
| تحصيل طلب واحد | `mark_order_paid(uuid)` + زر «تحصيل» في كل سطر طلب | طلبان: الأول مدفوع والثاني لا |
| علامة «أُغلق آليًا» | `table_board` يعيد آخر جلسة مغلقة؛ شارة خلال 24 ساعة | ظهرت بعد محاكاة إغلاق آلي |
| تصدير PNG | `lib/floor-plan-image.ts` مستعادًا على الجلسات (حالة + إجمالي) | تنزيل فعلي `floor-plan-2026-10-23.png` |
| `opened_by` لبيع POS | يُختم على الجلسة بعد نجاح الطلب، ولا يُستبدل | مرّ في مسار POS |
| pgTAP | 22 دعوى (أُضيفت 3 لسطح الدفع الفردي) | CI Fresh database أخضر |
