import Link from 'next/link';
import { cn } from '@/lib/utils';

/**
 * «مدعوم بـ دكان» — the platform credit on a tenant's public surface.
 *
 * WHY IT EXISTS: the storefront carries the merchant's own colour and logo, so a
 * customer had no signal that Dokan is the product behind it. The design audit
 * called that a trust gap, not a branding preference: the QR menu is where the
 * customer decides to pay.
 *
 * RULES:
 *  - neutral platform ink (`--color-text-tertiary`), never the tenant colour —
 *    the credit must not compete with, or fail contrast on, a merchant's brand;
 *  - 44px tall (it is a link on a phone, under a thumb);
 *  - one line, Arabic, with the wordmark bold: «مدعوم بـ دكان»;
 *  - links to the platform home, `dir` inherited (the phrase is Arabic).
 */
export function DokanCredit({ className }: { className?: string }) {
  return (
    <Link
      href="/"
      className={cn(
        'inline-flex min-h-11 items-center justify-center gap-1 text-caption text-[var(--color-text-tertiary)] transition-colors hover:text-[var(--color-text-secondary)]',
        className
      )}
    >
      <span>مدعوم بـ</span>
      <span className="font-bold text-[var(--color-text-secondary)]">دكان</span>
    </Link>
  );
}
