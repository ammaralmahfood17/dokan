'use client';

import { formatMoney } from '@/lib/utils';

/**
 * The floating cart bar («السلة · الإجمالي · إتمام الطلب»).
 *
 * Extracted verbatim from `menu-client.tsx` (architecture review 2026-10-13,
 * wave 4 phase b). The label switches to «مسح الرمز» when the session has no
 * table token — the honest wording, since without the token the order cannot be
 * placed (the server refuses it).
 */
export function MenuCartBar({
  itemCount,
  total,
  currency,
  orderingEnabled,
  onOpen,
}: {
  itemCount: number;
  total: number;
  currency: string;
  orderingEnabled: boolean;
  onOpen: () => void;
}) {
  return (
    <div className="fixed inset-x-0 bottom-0 z-[var(--z-sticky)] p-3 pb-safe-bottom">
      <div className="mx-auto w-full max-w-[480px] px-1 pb-1">
        <button
          type="button"
          onClick={onOpen}
          className="relative flex w-full items-center justify-between gap-3 rounded-[var(--radius-lg)] bg-[var(--color-text)] px-4 py-3 text-white shadow-float transition-transform active:scale-[0.98]"
        >
          <span className="flex items-center gap-2.5">
            <span className="flex h-[26px] w-[26px] items-center justify-center rounded-full bg-[var(--color-primary)] font-mono text-[12.5px] font-bold tabular-nums text-white">
              {itemCount}
            </span>
            <span className="text-[13.5px] font-semibold text-white/85">السلة</span>
          </span>
          <span className="flex items-center gap-3">
            <span className="font-mono text-[14px] font-bold tabular-nums text-white" dir="ltr">
              {formatMoney(total, currency)}
            </span>
            <span className="rounded-[var(--radius-md)] bg-[var(--color-primary)] px-4 py-2.5 text-[13px] font-bold text-white">
              {orderingEnabled ? 'إتمام الطلب' : 'مسح الرمز'}
            </span>
          </span>
        </button>
      </div>
    </div>
  );
}
