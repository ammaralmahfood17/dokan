# APPLE_REVIEW_FIXES.md — Apple Review Preparation Sprint

**Branch:** master (مباشرة — لا فرع)
**Date:** 2026-08-06
**Rules:** لا تغيير منطق عمل خارج نطاق كل تذكرة · لا حذف تحكم أمني · تعليق inline `// AR-x` فوق كل تعديل · numberingSystem latn إجباري لكل Intl عربي · build/tsc/lint صفر أخطاء.

---

## Ticket Summary

| Ticket | File(s) | Severity | Description | Status |
|---|---|---|---|---|
| **AR-1** | `src/lib/utils.ts` | P1 | `formatMoney()` كان toFixed() + تركيب نصي إنجليزي صرف. استُبدل بـ `Intl.NumberFormat` بلوكيل عربي لكل عملة (BHD→ar-BH, KWD→ar-KW, OMR→ar-OM, SAR→ar-SA, AED→ar-AE, QAR→ar-QA) مع **`-u-nu-latn` إجباري** — الأرقام 0-9 لاتينية دائمًا (لا ٠١٢)، الصياغة والوحدة عربية. أُضيف cache للمنسّقات (استدعاء متكرر في POS/القائمة/KDS). تحقق تشغيلي: `12.500 BHD` بلا أحرف هندية ✓ | ✅ |
| **AR-2** | `image-uploader.tsx` + `product-form-modal.tsx` | P2 | `<Image alt="">` فارغ → `alt={productName ? 'صورة X' : 'صورة المنتج'}` عبر prop اختياري `productName` يُمرَّر من النموذج | ✅ |
| **AR-3** | `telegram-manager.tsx` | P2 | ألوان صلبة → توكنز: `text-green-600` → `text-[var(--color-success)]` (مطلوب صراحة) + سلسلة sky-* (هوية تيليجرام) → توكنز info المكافئة (`--color-info`/`--color-info-tint`) لامتثال Design System v1.0 | ✅ |
| **AR-4** | `kitchen-ticket.tsx` | P2 | `<article>` التذكرة بلا اسم → `aria-label={`طلب رقم ${order.order_number}${overdue ? ' - متأخر' : ''}`}` | ✅ |
| **AR-5** | `kitchen-client.tsx` | P2 | ساعة KDS `toLocaleTimeString('ar-SA')` → `'ar-SA-u-nu-latn'` (سطران: init + tick) — أرقام إنجليزية دائمًا على أي ICU (iOS/macOS) | ✅ |
| **AR-6** | `api/telegram/webhook/route.ts` | P3 | `createAdminClient() as any` → النوع الطبيعي (أزل as any؛ الأنواع من database.types — tsc نظيف) | ✅ |
| **AR-7** | `lib/push.ts` | P3 | `console.log` (سطر الفشل + الملخص) → مغلّفة بـ `if (NODE_ENV !== 'production')` — لا ضجيج في الإنتاج | ✅ |
| **AR-8** | `dashboard/error.tsx` | P3 | `setTimeout(setCopied)` بلا تنظيف → `useEffect` مرتبط بـ `copied` مع `clearTimeout` عند إعادة النسخ أو الـ unmount | ✅ |
| **AR-9** | شامل (8 ملفات) | P3 | فحص كامل لكل `toLocale*`/`Intl.*` بلوكيل `ar-*` في src: أُضيف `numberingSystem: 'latn'` (أو `-u-nu-latn`) في كل موقع: `dashboard-data.ts` (labelFmt ساعات المخطط + weekdayFmt كان سليمًا)، `super-admin/analytics` (moneyFmt/numFmt/dateFmt ×2)، `super-admin/subscriptions` + `audit` (dateFmt)، `orders-client` (toLocaleString)، `analytics-client` (toLocaleDateString)، `dashboard/page.tsx` (time + date)، `settings-client` (expiryFmt)، `analytics/page.tsx` (arWeekdayFmt). **لا يوجد موقع موثق فيه أرقام هندية مقصودة** — كلها لاتينية الآن | ✅ |

---

## Verification

- `npm run build` — ✅ 0 أخطاء
- `npx tsc --noEmit` — ✅ 0 أخطاء
- `npm run lint` (max-warnings 0) — ✅ 0 تحذيرات
- **AR-1 تحقق تشغيلي** (node): BHD 12.5 → `12.500 BHD` · SAR 45.5 → `45.50 SAR` · صفر أحرف ٠-٩ في المخرجات ✓

## Files Modified (8)

1. `src/lib/utils.ts` (AR-1)
2. `src/components/dashboard/products/image-uploader.tsx` (AR-2)
3. `src/components/dashboard/products/product-form-modal.tsx` (AR-2)
4. `src/components/telegram-manager.tsx` (AR-3)
5. `src/components/dashboard/kitchen/kitchen-ticket.tsx` (AR-4)
6. `src/app/dashboard/kitchen/kitchen-client.tsx` (AR-5, AR-9)
7. `src/app/api/telegram/webhook/route.ts` (AR-6)
8. `src/lib/push.ts` (AR-7)
9. `src/app/dashboard/error.tsx` (AR-8)
10. `src/lib/dashboard-data.ts` (AR-9)
11. `src/app/super-admin/analytics/page.tsx` (AR-9)
12. `src/app/super-admin/subscriptions/page.tsx` (AR-9)
13. `src/app/super-admin/audit/page.tsx` (AR-9)
14. `src/app/dashboard/orders/orders-client.tsx` (AR-9)
15. `src/app/dashboard/analytics/analytics-client.tsx` (AR-9)
16. `src/app/dashboard/analytics/page.tsx` (AR-9)
17. `src/app/dashboard/settings/settings-client.tsx` (AR-9)
18. `src/app/dashboard/page.tsx` (AR-9)

## Notes

- **القاعدة رقم الأرقام**: كل Intl/تنسيق بلوكيل عربي يفرض `numberingSystem: 'latn'` (أو لاحقة `-u-nu-latn`) — لا استثناءات موثقة بأرقام هندية في المشروع.
- لا تغيير في منطق العمل (التسعير/الطلبات) — كل التعديلات تنسيق/عرض/نظافة.
