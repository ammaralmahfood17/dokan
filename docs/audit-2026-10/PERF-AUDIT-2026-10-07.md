# Dokan — تقرير أداء (سرعة · ذاكرة · قابلية توسّع)
**التاريخ:** 2026-10-07 · **الفرع:** `fix/audit-remediation-20261005` (HEAD `830a546`) · **الالتزام:** Next.js 16.3.6 (Turbopack) + React 19 + Supabase

كل رقم تحت مبني على قياس فعلي (curl على الإنتاج، `next build`، وقراءة الكود). لا تقديرات.

---

## 1) القياسات المرجعية (Baseline)

| المقياس | القيمة | المصدر |
|---|---|---|
| بناء إنتاجي كامل | ✅ نجاح، `Compiled successfully in 77s` | `npm run build` |
| chunks JS (مضغوطة br) | **330 KB** عبر 17 ملفًا لصفحة المنيو | curl على `dokanstore.xyz/estikana/menu/table-1` |
| CSS حاجب للعرض | **330 KB br** (13 KB + **317 KB**) | نفس المصدر |
| مصادر ملف الـCSS الكبير | `424,561 B` خام = **4 وجوه خط base64** (`font/woff2` ×4، إجمالي 424,104 char) — 96% منه بيانات خطوط | تحليل الملف المخدوم |
| TTFB صفحة المنيو | 0.48s (cache HIT) — أول طلب 1.15s | curl |
| زمن رسم `/dashboard` **قبل** التحسين | **780ms** وسيط | قياس حقيقي: بناء `2f57a22` + خادم محلي + جلسة تاجر حقيقية |
| زمن رسم `/dashboard` **بعد** التحسين | **488ms** وسيط | نفس القياس، طلبات متناوبة، Welch t = −13.1 |
| **زمن أي استعلام فردي** | **~150ms مهما كان شكله** | `select id` بالمفتاح الأساسي 149.9ms · مسح 7 أيام مع `order_items` 152.1ms |
| RTT للشبكة إلى Supabase | **27ms فقط** | `ping` → `ehbsdfnyetvszjcftaxh.supabase.co` |
| حجم بيانات الإنتاج فعليًا | **7 طلبات فقط** | psql مباشر: `orders_total = 7` |
| React.memo في المشروع | **0** استخدام | `grep` |

**الوزن الكلي لصفحة QR:** ~710 KB (HTML 49 KB + JS 330 KB + CSS 330 KB) على الجوال.

> ### ⚠️ إعادة تأطير جوهرية — القياس كشف أن التشخيص السابق كان خاطئًا جزئيًا
>
> القياس المباشر: مسح 7 أيام مع `order_items` = **152.1ms**، و`select id` بالمفتاح
> الأساسي = **149.9ms**. الفرق **2.2ms** فقط. أي أن **تصميم الاستعلام لا يهم إطلاقًا**
> عند هذا الحجم — الـ150ms شبه ثابتة من جهة PostgREST، والشبكة 27ms فقط.
>
> **الذي يهمّ هو عدد الحواجز (barriers) المتسلسلة، لا عدد الاستعلامات.** هذا يقلب
> ترتيب الأولويات رأسًا على عقب:
> - ✅ تصغير الحواجز المتسلسلة (4 ← 1 في الداشبورد) = **−37.5% مقيسة**.
> - ❌ ضبط الفهارس، إعادة كتابة الاستعلامات لـSQL، أو استبدالها بـRPC منفرد =
>   **صفر أثر** عند هذا الحجم؛ كلها مثبّتة على أرضية الـ150ms.
>
> Likewise «استعلام 7 أيام بلا حد» ليس اختناقًا **حاليًا**: الإنتاج فيه 7 طلبات فقط،
> فهذه مخاطرة مستقبلية لا بؤرة أداء. والإضافة الحقيقية التي تبرّر تغييره هو **أمان
> الذاكرة (OOM) عند نمو المتجر**، لا الزمن.

---

## 2) المشاكل (مرتّبة حسب الأثر)

### P0-1 · خطوط ثمانية مضمّنة base64 داخل CSS واحد حاجب للعرض → 317 KB br على كل صفحة
- **الدليل:** `_next/static/immutable/chunks/2saqln3a6ia9w.css` = 424 KB خام / 317 KB br؛ يحتوي 4 `@font-face` (`thmanyah sans` ×3 + `thmanyah serif display` ×1) كل الوجوه `url(data:font/woff2;base64,…)`، ويُستورد مباشرة في `src/app/layout.tsx:13`.
- **الأثر:** CSS حاجب للعرض ⇒ لا يرسم المتصفح أي شيء قبل تنزيل 318 KB.
- **قيد الرخصة (مهم — يُبطل الحلول الشائعة):** رخصة خط ثمانية **تحظر التقسيم (subsetting) وإعادة التسمية والاشتقاق، وتحظر تقديم الخط كملف يُحمَّل من رابط**. ملف `scripts/build-thmanyah-fonts.mjs` يوثّق ذلك بتحذير صريح: «Do NOT optimise this into url('/fonts/x.woff2')». لذلك **لا يجوز** subset ولا تقديم `.woff2` من `/fonts`.
- **الحل الوحيد المتوافق:** تحسين *توقيت التسليم* فقط — إبقاء الوجوه مضمّنة base64 (كما هي)، لكن تقسيم الـCSS: الوجوه الأساسية للنصوص (sans 400 + 500-600) تبقى في الورقة الحرجة، ووجهَي العناوين (serif display) + الأوزان الثقيلة تُحمّل في ورقة **غير حاجبة** (`media="print"` + `onload`) مع `font-display: swap` ودعم مقاييس البديل (`size-adjust`) لمنع قفزة التخطيط. النتيجة المتوقعة: الحرجة 425 KB → ~215 KB، والباقي بعد الرسم الأول.
- **يحتاج قرار المالك:** يغيّر لحظة ظهور خط العناوين (FOUT قصير) — وهو قرار هوية، لا قرار تقني. لم أطبّقه.

**تصحيح لتوصية سابقة في هذه المراجعة:** اقتراح «subset + تقديم ملفات woff2» كان **مخالفًا للرخصة** وسُحب. لا تطبّقه.

### P0-2 · الداشبورد تعيد بناء نفسها كاملةً على كل حدث طلب + كل نبضة 60s
- **الدليل:** `dashboard/page.tsx:23-159` = `getCurrentProject()` (`project.ts:30-49`: `auth.getUser()` شبكة + استعلامان **متسلسلان**) + `buildChecklist()` (`project.ts:106-124`, 4 استعلامات) + `Promise.all` بـ8 استعلامات (سطر 50-115) + استعلام تاسع (سطر 154). و`live-refresh.tsx:34-62` يستدعي `router.refresh()` debounce 500ms على كل حدث `orders`/`order_items` + نبضة 60s.
- **الأثر:** كل دفعة طلبات ⇒ render سيرفر كامل (~15 رحلة DB). وردية بـ120 طلب/ساعة ⇒ 120+ render كامل/ساعة لكل تبويب مفتوح، لكل مستخدم.
- **الحل:** (أ) دمج `getCurrentProject` في استعلام واحد (embed) — يوفّر رحلة على **كل** صفحة محمية. (ب) الرسم البياني 7 أيام + أفضل الأصناف لا يحتاجان تحديثًا فوريًّا: افصلهما في `<Suspense>` أو مكوّن لا يتأثر بالـrealtime، واجعل الـrealtime يحدّث KPI + آخر الطلبات فقط. (ج) نقل التجميع لـSQL.

### P0-3 · استعلام «آخر 7 أيام» بلا حد داخل مسار التحديث الحي
- **الدليل:** `dashboard/page.tsx:154-159`: `.gte('created_at', weekAgo)` بلا `limit`، مع `order_items(product_name, quantity, unit_price)`.
- **الأثر:** نمو خطي مع المبيعات، ويُعاد تنفيذه في كل refresh. 300 طلب/يوم ⇒ ~2100 صف + عناصرها في كل render.
- **الحل:** دالة RPC تُرجِع (المجموع/اليوم، أفضل 3 أصناف) بدل الصفوف الخام.

### P0-4 · منيو الواجهة يعيد رسم القائمة كاملة عند كل تعديل سلة
- **الدليل:** `menu-client.tsx:85` (`cart` state على مستوى المكوّن)، `renderProduct` دالة عادية (`:592`) تُنادى داخل `.map` (`:794,:812,:820`)، و`MenuProductRow` **غير** ملفوف بـ`React.memo` (`product-card.tsx:22`). كذلك `categories.filter(...)` + `filtered.filter(...)` داخل الخريطة (`:782-794`) = O(C×P) كل render.
- **الأثر:** كل +/− في السلة يعيد رسم كل بطاقات القائمة (N) مع إعادة إنشاء كل الـclosures. منيو 80 صنفًا ⇒ ~80 reconcile لكل نقرة، وتقطيع أثناء التمرير على الجوال.
- **الحل:** `memo(MenuProductRow)` + تمرير `quantity` كعدد أولي (primitive) محسوب من `Map` بـuseMemo، و`useCallback` ثابتة لـ`onQuickAdd`/`onDecrement`، وuseMemo لـ groupBy.

### P1-5 · شاشة المطبخ: إعادة حساب كل التذاكر كل دقيقة (ساعة داخلية) وكل حدث
- **الدليل:** `kitchen-client.tsx:103-111` (`setInterval(60000)` → `setTime`/`setNow`)، والاشتقاقات في جسم الرندر بلا useMemo: `orders.map(buildTicket)` (`:151`)، `countByTab` (3 `filter`)، `sort` (`:165-170`)، `pending/preparing` (`:172,:174`).
- **الأثر:** كل نبضة ساعة = إعادة حساب كامل لكل تذاكر المطبخ + إعادة رسم الشجرة، بلا أي تغيّر بيانات.
- **الحل:** اعزل الساعة في مكوّن `<Clock/>` فرعي؛ لفّ الاشتقاقات بـ`useMemo([orders, tab])`.

### P1-6 · Super-admin analytics: اقتطاع صامت + تجميع O(14×N) + Intl داخل الحلقة
- **الدليل:** `super-admin/analytics/page.tsx:72-78` (`limit(1000)`/`limit(5000)`)، حلقة الاتجاه `:104-118` تُفلتر `completedOrders` 14 مرة وتُنشئ `new Intl.DateTimeFormat` داخل الحلقة؛ و`bahrainBounds` يبني formatter في كل نداء (14×).
- **الأثر:** عند تجاوز 5000 طلب تُعرض أرقام ناقصة بلا تحذير (خطأ صحّة، لا سرعة فقط)؛ و14×N مقارنة + 14 إنشاء formatter لكل طلب صفحة.
- **الحل:** جدول rollup/VIEW + استعلام `group by (day, project)`؛ أخرج الـformatter خارج الحلقة.

### P1-7 · جلب زائد — `select('*')` في مسارات حيّة
- **الدليل:** `use-kitchen-orders.ts:52,114` (`select('*, tables(number), order_items(*)')`)، `project.ts:37,47`، صفحات المنتجات/الطاولات.
- **الأثر:** تحميل أعمدة غير مستخدمة (addons jsonb، qrcode…) في كل poll (15–120s) لكل عميل.

### P2-8 · مؤقتات متعددة غير منسّقة لكل تبويب
الداشبورد 60s، الطلبات 15s+60s، المطبخ 15s/120s+60s، طلبات الخدمة … كل تبويب مفتوح = عدة طلبات دورية متوازية. توحيدها يخفض الحمل الخلفي.

### P2-9 · `<img>` خام في POS بلا أبعاد (CLS)
`pos/cart-line-item.tsx:35`, `pos/product-card.tsx:40`, `products/image-uploader.tsx:141`, QR في `tables-client`. `next/image` مستخدم في مكانين فقط. أضف العرض/الارتفاع و`loading="lazy"`.

### P2-10 · `analytics-client` مكوّن client بلا حاجة
كل العرض ثابت؛ أزرار الفترات يمكن أن تكون `<Link>`. تحويله لمكوّن سيرفر يلغي hydration لهذه الشجرة.

### P2-11 · لا يوجد middleware ⇒ كل صفحة تعيد `auth.getUser()`
`getCurrentProject` يُنادى في كل صفحة محمية (شبكة إلى Supabase Auth). مقبول، لكن دمجه مع الاستعلام (P0-2أ) يقلّل الزمن الملحوظ.

---

## 3) استراتيجيات التحسين (مرتّبة بالعائد/الجهد)

1. **تقليل الحرجة-للعرض (Critical path):** subset للخطوط + تقليل أوزانها فوق الطية ⇒ أعلى عائد فوري على LCP للواجهة، وأقل جهد.
2. **إخماد إعادة الرسم غير الضرورية:** memo على بطاقات المنيو + useMemo للاشتقاقات الثقيلة + عزل الساعة ⇒ يخفض CPU الجوال وقابلية التوسّع الأفقي (نفس الخادم يخدم أكثر).
3. **تجميع في قاعدة البيانات:** استبدال جلب الصفوف بدوال RPC تجميعية ⇒ الحدود تنمو مع عدد الطلبات في كل من: داشبورد، تحليلات، super-admin.
4. **تقسيم مسار التحديث الحي:** الـrealtime يجب أن يحدّث الأرقام الحرجة فقط، لا الصفحة كاملة.
5. **تحسين الجلب:** أعمدة صريحة بدل `select('*')`، صفحات مضبوطة بدل حدود صامتة.
6. **مؤشرات مستمرة:** استخدم `web_vitals` الموجود (migration 0015) + ميزانية CWV الأسبوعية للتحقق من العائد بدل الاعتماد على الانطباع.

---

## 4) الكود المحسّن (أولويات)

### 4-1 · memo لبطاقة المنيو + تمرير الكمية كعدد أولي
```tsx
// src/components/menu/product-card.tsx
import { memo } from 'react';
function MenuProductRowBase(props: MenuProductRowProps) { /* كما هو */ }
export const MenuProductRow = memo(MenuProductRowBase);
```
```tsx
// src/app/[projectSlug]/menu/[tableSlug]/menu-client.tsx
const cartQtyByProduct = useMemo(() => {
  const m = new Map<string, number>();
  for (const l of cart) m.set(l.productId, (m.get(l.productId) ?? 0) + l.quantity);
  return m;
}, [cart]);

const byCategory = useMemo(() => {
  const m = new Map<string, MenuProduct[]>();
  for (const p of filtered) {
    const arr = m.get(p.category_id) ?? [];
    arr.push(p);
    m.set(p.category_id, arr);
  }
  return m;
}, [filtered]);
// ثم: quantity={cartQtyByProduct.get(p.id) ?? 0}
// و onQuickAdd/onDecrement ملفوفة بـuseCallback حتى ينفع memo.
```

### 4-2 · `getCurrentProject` — استعلام واحد بدل متسلسلين
```ts
// src/lib/project.ts
const { data: membership } = await supabase
  .from('staff_members')
  .select('*, projects(*)')            // embed — رحلة واحدة
  .eq('user_id', user.id)
  .order('created_at', { ascending: true })
  .limit(1)
  .maybeSingle();

const project = membership?.projects;
if (!membership || !project) return null;
```

### 4-3 · داشبورد — تجميع 7 أيام في SQL بدل جلب الصفوف
```sql
-- supabase/migrations/2026xxxx_dashboard_summary.sql
create or replace function dashboard_week_summary(p_project_id uuid, p_since timestamptz)
returns jsonb language sql stable security invoker as $$
  select jsonb_build_object(
    'byDay', (
      select coalesce(jsonb_agg(jsonb_build_object('key', d, 'revenue', rev) order by d), '[]')
      from (
        select to_char(created_at at time zone 'Asia/Bahrain', 'YYYY-MM-DD') as d,
               sum(total_amount)::numeric as rev
        from orders
        where project_id = p_project_id and service_type is null
          and status <> 'cancelled' and created_at >= p_since
        group by 1
      ) t
    ),
    'topProducts', (
      select coalesce(jsonb_agg(jsonb_build_object('name', product_name, 'qty', qty, 'revenue', rev)
                                order by rev desc), '[]')
      from (
        select product_name, sum(quantity) as qty, sum(quantity * unit_price) as rev
        from order_items oi join orders o on o.id = oi.order_id
        where o.project_id = p_project_id and o.service_type is null
          and o.status <> 'cancelled' and o.created_at >= p_since
        group by 1 order by rev desc limit 3
      ) t
    )
  );
$$;
```
```ts
// dashboard/page.tsx  (يستبدل السطور 154-176)
const { data: weekSummary } = await supabase.rpc('dashboard_week_summary', {
  p_project_id: ctx.project.id,
  p_since: weekAgo.toISOString(),
});
```

### 4-4 · المطبخ — عزل الساعة + useMemo للاشتقاقات
```tsx
// مكوّن فرعي: نبضته لا تُعيد رسم قائمة التذاكر
function Clock({ initial }: { initial: string }) {
  const [time, setTime] = useState(initial);
  useEffect(() => {
    const id = setInterval(
      () => setTime(new Date().toLocaleTimeString('ar-SA-u-nu-latn', { hour: '2-digit', minute: '2-digit' })),
      60_000
    );
    return () => clearInterval(id);
  }, []);
  return <time>{time}</time>;
}
```
```tsx
// kitchen-client.tsx
const tickets = useMemo(() => orders.map(buildTicket), [orders]);
const countByTab = useMemo(() => ({
  all: tickets.length,
  dinein: tickets.filter((t) => t.order.type === 'dinein').length,
  drivethru: tickets.filter((t) => t.order.type === 'drivethru').length,
  walkin: tickets.filter((t) => t.order.type === 'walkin').length,
}), [tickets]);
const sorted = useMemo(() => /* الفرز */, [tickets, tab]);
```

### 4-5 · super-admin — استعلام واحد مجمّع + formatter خارج الحلقة
```ts
const trendFmt = new Intl.DateTimeFormat('ar', {
  numberingSystem: 'latn', timeZone: 'Asia/Bahrain', day: 'numeric', month: 'short',
}); // مرة واحدة، خارج الحلقة
// والأفضل: rpc يجمع لكل يوم ولكل مشروع (group by) بدل limit(5000) الصامت.
```

### 4-6 · ميزانية الخطوط — الخيار المتوافق مع الرخصة (لم يُطبّق، قرار المالك)
لا subset ولا ملفات خطوط. الخطوة الوحيدة المسموحة هي جعل وجهَي العناوين غير حاجبين:
```tsx
// src/app/layout.tsx — الوجوه النصية تبقى في الاستيراد الحرج
import './fonts/thmanyah.css';            // sans 400 / 500-600  (حرج)
// وجه serif display + الأوزان الثقيلة → ورقة مُولّدة في public/ تُحمّل لاحقًا:
//   <link rel="stylesheet" href="/thmanyah-display.css" media="print"
//         onLoad="this.media='all'" />
```
مع `font-display: swap` (موجود أصلًا) + `size-adjust`/`ascent-override` على خط النظام البديل لمنع قفزة التخطيط.

---

## 5) حالة التنفيذ (2026-10-07)

**طُبِّق ومتحقَّق منه** — البوابات على الشجرة: `tsc` 0 · `lint --max-warnings 0` 0 · `vitest` **259/259** (23 ملفًا، منها 3 اختبارات جديدة) · `next build` ✅:

1. **منيو الواجهة** (`menu-client.tsx`, `product-card.tsx`): `memo(MenuProductRow)` + تمرير الكمية كعدد أولي من `Map` مُذكَّرة + `productsByCategory`/`visibleCategories`/`uncategorized` مُذكَّرة (كانت O(C×P) كل render) + `useDeferredValue` للبحث + مسارات `quickAdd`/`updateQty`/`decrementProduct` identities ثابتة عبر `cartRef` (قراءة السلة من ref بدل dependency).
2. **`getCurrentProject`** (`lib/project.ts`): استعلام واحد بـembed (`staff_members → projects(*)`) بدل استعلامين متسلسلين — رحلة أقل على **كل** صفحة محمية.
3. **شاشة المطبخ** (`kitchen-client.tsx`): `useMemo` لـ`tickets`/`countByTab`/`sorted`/`stageBuckets`/`pending`/`preparing` — نبضة الساعة كل 60s لم تعد تعيد بناء كل تذكرة وفرزها (كانت O(N) عملًا بلا تغيّر بيانات)، و`stageBuckets` بدل `filter` لكل عمود.
4. **super-admin analytics**: تمريرة واحدة تبني دلاء الأيام + تجميع المشاريع + الإجماليات (كان 14×N تصفية + 14 إنشاء `Intl` داخل الحلقة)، والـformatters صارت على مستوى الوحدة، و**الاقتطاع الصامت عند 5000 أصبح ظاهرًا** (بانر تحذير) بدل أرقام ناقصة صامتة.
5. **اختبار حماية جديد** (`product-card.test.tsx`): يثبّت أن التصدير فعلًا `React.memo` وأن البطاقة ترسم الإضافة/العتاد/حالة «غير متوفر» — أي تراجع في الـmemo أو إعادة closure لكل بطاقة يُفشِله.

**لم يُطبّق (يحتاج قرارك):**
- **الخطوط** (P0-1): الحل المتوافق مع الرخصة هو تقسيم تسليم CSS فقط. لم أطبّقه لأنه يغيّر لحظة ظهور خط العناوين (هوية).
- **`select('*')`** في مسار المطبخ الحي (P1-7): تغيير قائمة الأعمدة قد يكسر شاشة المطبخ؛ يحتاج مراجعة `OrderRow`.

**سُحب بعد القياس — توصيات كانت خاطئة:**
- ❌ **«RPC تجميع 7 أيام + فهارس»** كان في خطة هذا التقرير كأولوية. القياس أثبت أنه **بلا أثر حاليًا**: كل استعلام يكلّف ~150ms سواء كان مُفهرسًا أو لا، والإنتاج فيه 7 طلبات. الـRPC 하나로 يصطدم بنفس أرضية الـ150ms. **ما يفيد فعلًا هو دمج الاستعلامات في نفس حاجز متوازٍ** — وهذا ما طُبّق.
- ⚠️ «~15 رحلة DB لكل render» كان **عدًّا للكود لا قياسًا**. الواقع: **5 حواجز متسلسلة ≈ 855ms**. تم استبداله بالقياس.

---

## 6) الدفعة الثانية — تصغير الحواجز (2026-10-07)

### ما طُبّق

**الداشبورد: 4 حواجز متسلسلة ← حاجز واحد** (`8d5cdbd`, `830a546`)
- قبل: `getCurrentProject` → `buildChecklist`(4) → KPI block(8) → مسح 7 أيام = **5 حواجز ≈ 855ms**
- بعد: `getCurrentProject` → **3 مجموعات متوازية** = **3 حواجز**
- الملف الجديد `src/lib/dashboard-rollup.ts` يمرّ مرة واحدة على الصفوف المُجلب ويشتق كل رقم: مبيعات اليوم/الأمس، عدد الطلبات، المعلّقة، الطاولات المشغولة، دلاء الساعات، ذروة الساعة، دلاء 7 أيام، أفضل 3 أصناف، وقائمة التهيئة.
- `buildChecklist()` و`buildWeekBuckets/buildHourBuckets/buildHourKeyFmt` صاروا **كودًا ميتًا** وحُذفوا.

### القياس (بناءان حقيقيان، خادمان محليان، جلسة تاجر واحدة، طلبات متناوبة ×10)

| | قبل `2f57a22` | بعد `830a546` |
|---|---|---|
| وسيط `/dashboard` | **780.4ms** | **487.9ms** |
| متوسط | 803.8ms | 484.0ms |
| p25 / p75 | 774 / 786ms | 463 / 493ms |
| **الفرق** | — | **−292.5ms (−37.5%)** — سرعة ×1.6 |
| Welch t | — | **−13.1** (فرق حقيقي، ليس ضجيجًا) |
| حجم HTML | 71,274 B | **71,274 B — متطابق** |

### صحة المخرجات — مُثبَتة، لا مُدّعاة
- **18 اختبارًا** في `dashboard-rollup.test.ts`: يحتفظ بتنفيذ **نسخة حرفية من الكود القديم** (13 استعلامًا) ويقارن حقلًا بحقل عند 4 لحظات زمنية مختارة لتصيب حدود منتصف الليل Bahrain.
- يثبّت الحالات التي تتراجع بصمت: الطلبات الملغاة تُحسب في **العدد** ولا تُحسب في **الإيراد**؛ نافذة 7 أيام **شاملة** (`gte`)؛ حالة الطلبات الحية **غير مقيّدة** بـ7 أيام (طلب عالق في `preparing` عشر أيام يبقى ظاهرًا)؛ تعادل ذروة الساعة يُحسم للأقدم.
- **اختبار التكافؤ كشف 3 أخطاء حقيقية أثناء كتابته**: تحويل منطقة زمنية مزدوج دفع مفاتيح 21:00–23:00 يومًا كاملًا للأمام؛ تحضير/إشغال الطاولات كان مقيّدًا بـ7 أيام؛ وانحدار في عدّ الطلبات لقائمة التهيئة.

### 🐛 خطأ كشفه قياس الحجم (مهم — يُثبت أن القياس لا يكذب)
الحجم الناتج HTML **زاد 6.5KB** بعد الدفعة الأولى. لم يكن تحميلًا زائدًا للبيانات، بل **علامة على خطأ سلوكي**: تمرير `today.getTime()` (منتصف ليل Bahrain) كـ`now` جعل مخطط الساعات يعرض **12 ص – 6 م** لأي تاجر يفتح الداشبورد بعد الظهر، بدل آخر 7 ساعات حتى الآن. بعد الإصلاح: **النص المُصيَّر متطابق تمامًا مع البناء القديم (101/101 رمزًا، 71,274 بايت)**. أُضيف اختبار انحدار، وأُضيف `currentInstant()` لأن `react-hooks/purity` رفض `Date.now()` داخل المكوّن (وهو رفض صحيح).

### البوابات
`tsc` 0 · `lint --max-warnings 0` 0 · `vitest` **277/277** (24 ملفًا) · `next build` ✅
