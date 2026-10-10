import Link from 'next/link';

/**
 * Graceful "this QR cannot order" surface.
 *
 * Why this exists instead of `notFound()`: the customer menu route is
 * `export const dynamic = 'force-static'`, and inside a forced-static route Next
 * SWALLOWS `notFound()` — measured on production, an unknown store slug or a
 * deleted/inactive table slug answered **HTTP 200 with an empty shell** (only the
 * skip link in the body). A customer scanning the QR of a table that was renamed,
 * deleted or deactivated got a blank screen: no message, no way forward.
 *
 * Rendering real content is the fix that matters to the customer. The status code
 * cannot be a per-path 404 in a static route, and trading the menu's static
 * caching away for a status code is not worth it — the landing page (`/[slug]`)
 * still 404s correctly because it is not force-static.
 */
export function Unavailable({ kind }: { kind: 'store' | 'table' }) {
  const msg = kind === 'table'
    ? 'رمز الطاولة غير صالح أو الطاولة غير مفعّلة — امسح رمز QR الموجود على طاولتك'
    : 'هذا المتجر غير متاح حالياً';
  return (
    <main dir="rtl" className="flex min-h-dvh flex-col items-center justify-center gap-3 px-6 text-center">
      <h1 className="text-lg font-bold">{msg}</h1>
      <p className="text-sm text-[var(--color-text-secondary)]">اسأل موظف المطعم للمساعدة</p>
      {/* `<Link>`, not `<a>`: the repo's eslint config runs with --max-warnings 0 and
          `@next/next/no-html-link-for-pages` rejects a raw anchor for an internal route.
          Link renders the same <a class="btn">. */}
      <Link className="btn" href="/">الصفحة الرئيسية</Link>
    </main>
  );
}
