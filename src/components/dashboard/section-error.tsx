'use client';

import { AlertTriangle, RefreshCw } from 'lucide-react';

/**
 * The one error boundary every dashboard section renders.
 *
 * Extracted from seven byte-identical `error.tsx` files (analytics, kitchen,
 * orders, pos, products, settings, tables — same md5). A section route now
 * re-exports this instead of pasting the markup, so the copy, the icon and the
 * a11y wiring change in one place.
 *
 * Props are dictated by the Next.js App Router: a route-level `error.tsx`
 * receives `{ error, reset }` and must default-export the component.
 */
export function SectionError({
  reset,
}: {
  error: Error & { digest?: string };
  reset: () => void;
}) {
  return (
    <div
      className="flex min-h-[50vh] flex-col items-center justify-center gap-4 p-6 text-center"
      role="alert"
      aria-live="assertive"
    >
      <AlertTriangle className="h-12 w-12 text-[var(--color-danger)]" />
      <h2 className="text-lg font-semibold">حدث خطأ في هذه الصفحة</h2>
      <p className="text-sm text-[var(--color-text-secondary)]">يرجى المحاولة مرة أخرى</p>
      <button onClick={reset} className="btn btn-primary">
        <RefreshCw className="h-4 w-4" />
        إعادة المحاولة
      </button>
    </div>
  );
}
