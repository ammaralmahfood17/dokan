'use client';

import { X } from 'lucide-react';
import { formatMoney } from '@/lib/utils';

/**
 * «وصل الطلب للمطبخ» — the confirmation banner.
 *
 * Extracted verbatim from `pos-client.tsx` (architecture review 2026-10-13,
 * wave 4 phase b). It shows the order number and the total the SERVER returned,
 * not what the cart calculated — the cashier reads this as proof the order
 * exists.
 */
export function PosOrderConfirmed({
  order,
  currency,
  onDismiss,
}: {
  order: { orderNumber: number; totalAmount: number };
  currency: string;
  onDismiss: () => void;
}) {
  return (
    <div className="fixed inset-x-0 top-3 z-[var(--z-modal)] flex justify-center px-4">
      <div className="flex min-h-[52px] w-full max-w-md items-center justify-between gap-3 rounded-[var(--radius-lg)] bg-[var(--color-success)] px-4 py-2.5 text-white shadow-float">
        <div className="flex min-w-0 items-center gap-2.5">
          <span className="flex h-7 w-7 shrink-0 items-center justify-center rounded-full bg-white/20 text-sm font-bold">
            ✓
          </span>
          <div className="min-w-0">
            <p className="text-sm font-bold leading-tight">وصل الطلب للمطبخ</p>
            <p className="truncate text-[11.5px] leading-tight opacity-90" dir="ltr">
              order-{order.orderNumber} · {formatMoney(order.totalAmount, currency)}
            </p>
          </div>
        </div>
        <button
          type="button"
          onClick={onDismiss}
          aria-label="إغلاق"
          className="flex h-11 w-11 shrink-0 items-center justify-center rounded-full transition-colors hover:bg-white/20"
        >
          <X className="h-4 w-4" />
        </button>
      </div>
    </div>
  );
}
