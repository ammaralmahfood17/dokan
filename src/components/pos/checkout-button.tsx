import { cn } from '@/lib/utils';

/**
 * Polaris-style checkout CTA: full-width brand primary (--color-primary),
 * 16px / 600, 8px radius, ≥44px touch target. Shows a spinner while
 * submitting. Follows the app's primary token so it stays in sync with the
 * brand (indigo) in both light and dark themes.
 */
export function CheckoutButton({
  loading,
  disabled,
  onClick,
  children,
  className,
}: {
  loading?: boolean;
  disabled?: boolean;
  onClick: () => void;
  children: React.ReactNode;
  className?: string;
}) {
  return (
    <button
      type="button"
      /* audit T1 #21: the spinner is aria-hidden by design, so without aria-busy the button
         announced nothing while it worked - the one CTA where silence is expensive. */
      aria-busy={loading || undefined}
      onClick={onClick}
      disabled={disabled || loading}
      className={cn(
        'flex min-h-[44px] w-full items-center justify-center gap-2 rounded-[var(--radius-md)] bg-[var(--color-primary)] px-4 text-base font-semibold text-white',
        'transition-colors duration-150 hover:bg-[var(--color-primary-hover)] active:scale-[0.98]',
        'disabled:cursor-not-allowed disabled:opacity-50',
        className
      )}
    >
      {loading && (
        <span className="h-4 w-4 animate-spin rounded-full border-2 border-white/30 border-t-white motion-reduce:hidden" />
      )}
      {children}
    </button>
  );
}
