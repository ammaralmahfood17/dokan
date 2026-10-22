'use client';

import type { ComponentProps } from 'react';
import { ShoppingBag, X } from 'lucide-react';
import { formatMoney } from '@/lib/utils';
import { CartPanel } from '@/components/pos/cart-panel';

type CartPanelProps = ComponentProps<typeof CartPanel>;

/**
 * The POS cart on small screens: the floating total bar and the bottom sheet.
 *
 * Extracted verbatim from `pos-client.tsx` (architecture review 2026-10-13,
 * wave 4 phase b). Both render the SAME `CartPanel` the desktop column uses —
 * the sheet is a shell around it, not a second implementation — which is why
 * this component takes the panel's props as one object instead of re-listing
 * twenty of them (a re-listed set is exactly how the two carts drifted apart
 * before).
 */
export function PosMobileCart({
  panel,
  itemCount,
  total,
  currency,
  submitting,
  open,
  onOpen,
  onClose,
}: {
  panel: CartPanelProps;
  itemCount: number;
  total: number;
  currency: string;
  submitting: boolean;
  open: boolean;
  onOpen: () => void;
  onClose: () => void;
}) {
  return (
    <>
      {/* ── Mobile: floating total bar ───────────────────────────────── */}
      <div
        data-pos-floating-bar
        className="fixed bottom-[calc(var(--bottom-nav-h)+env(safe-area-inset-bottom))] start-0 end-0 z-[var(--z-drawer)] border-t border-[var(--color-border)] bg-[var(--color-surface)]/95 p-3 pb-safe-bottom backdrop-blur-md md:bottom-0 md:start-[88px] lg:start-56 xl:hidden"
      >
        <button
          type="button"
          onClick={onOpen}
          disabled={submitting}
          aria-haspopup="dialog"
          aria-label="عرض السلة"
          className="flex min-h-[48px] w-full items-center justify-between gap-3 rounded-[var(--radius-md)] bg-[var(--color-primary)] px-4 text-white transition-colors active:scale-[0.98] hover:bg-[var(--color-primary-hover)]"
        >
          <span className="flex items-center gap-2 text-sm font-semibold">
            <ShoppingBag className="h-4 w-4" />
            {itemCount > 0 ? `${itemCount} قطعة` : 'السلة فارغة'}
          </span>
          <span className="flex items-center gap-1 text-base font-bold tabular-nums">
            {formatMoney(total, currency)}
          </span>
        </button>
      </div>

      {/* ── Mobile: cart bottom sheet ────────────────────────────────── */}
      {open && (
        <div
          className="fixed inset-0 z-[var(--z-modal)] flex items-end justify-center bg-black/40 xl:hidden"
          role="dialog"
          aria-modal="true"
          aria-label="سلة الطلب"
          onClick={(e) => {
            if (e.target === e.currentTarget) onClose();
          }}
          onKeyDown={(e) => {
            if (e.key === 'Escape') onClose();
          }}
        >
          <div className="flex h-[85dvh] w-full max-w-lg flex-col overflow-hidden rounded-t-2xl bg-[var(--color-surface)] animate-slide-up">
            <div className="flex items-center justify-between border-b border-[var(--color-border)] px-4 py-2">
              <span className="mx-auto h-1 w-10 rounded-full bg-[var(--color-border)]" aria-hidden="true" />
              <button
                type="button"
                onClick={onClose}
                className="btn btn-ghost btn-sm absolute end-3"
                aria-label="إغلاق السلة"
              >
                <X className="h-4 w-4" />
              </button>
            </div>
            <CartPanel {...panel} className="min-h-0 flex-1" />
          </div>
        </div>
      )}
    </>
  );
}
