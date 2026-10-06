'use client';

import { useMemo, useState } from 'react';
import { RotateCcw, ShoppingBag, Trash2 } from 'lucide-react';
import { cn, formatMoney } from '@/lib/utils';
import type { Product, OrderType } from '@/lib/types';
import { CartLineItem } from './cart-line-item';
import { CheckoutButton } from './checkout-button';
import { POSBadge } from './pos-badge';
import { Modal } from '@/components/ui/modal';
import type { PosLine } from './types';

/**
 * Polaris-style cart panel. Full-height flex column: header (title + type
 * selector + clear), scrollable line items (or empty state), footer
 * (notes + subtotal/total + checkout). Reused as the desktop side column
 * and inside the mobile bottom sheet. Rendered with logical properties
 * so RTL flips it automatically.
 */
export function CartPanel({
  lines,
  products,
  currency,
  type,
  onTypeChange,
  notes,
  onNotesChange,
  onClear,
  onRepeat,
  repeatLoading,
  onIncrement,
  onDecrement,
  onRemove,
  onSetQuantity,
  // UX-U13: كميات سريعة
  onAddQuantity,
  onSubmit,
  submitting,
  className,
}: {
  lines: PosLine[];
  products: (Product & { product_addons?: { id: string }[] })[];
  currency: string;
  type: OrderType;
  onTypeChange: (t: OrderType) => void;
  notes: string;
  onNotesChange: (v: string) => void;
  onClear: () => void;
  onRepeat: () => void;
  repeatLoading: boolean;
  onIncrement: (key: string) => void;
  onDecrement: (key: string) => void;
  onRemove: (key: string) => void;
  onSetQuantity: (key: string, qty: number) => void;
  /** UX-U13: إضافة كمية دفعة واحدة (+2/+5) */
  onAddQuantity: (key: string, qty: number) => void;
  onSubmit: () => void;
  submitting: boolean;
  className?: string;
}) {
  const thumbnails = useMemo(
    () => new Map(products.map((p) => [p.id, p.image_url])),
    [products]
  );

  const itemCount = lines.reduce((s, l) => s + l.quantity, 0);
  const subtotal = lines.reduce((s, l) => s + l.unitPrice * l.quantity, 0);
  const [confirmClear, setConfirmClear] = useState(false);

  return (
    <section
      className={cn(
        'flex h-full min-h-0 flex-col border-s border-[var(--color-border)] bg-[var(--color-surface)]',
        className
      )}
      aria-label="سلة الطلب"
    >
      {/* Header */}
      <header className="shrink-0 border-b border-[var(--color-border)] px-4 py-3">
        <div className="flex items-center justify-between gap-2">
          <div className="flex items-center gap-2">
            <h2 className="text-[20px] font-bold leading-7 text-[var(--color-text)]">
              السلة
            </h2>
            <POSBadge variant={lines.length ? 'success' : 'neutral'}>
              {itemCount} قطعة
            </POSBadge>
          </div>
          <div className="flex items-center gap-1">
            <button
              type="button"
              onClick={onRepeat}
              disabled={repeatLoading}
              aria-label="إعادة آخر طلب"
              title="إعادة آخر طلب"
              className="flex h-11 items-center gap-1.5 rounded-[var(--radius-md)] px-2.5 text-sm font-semibold text-[var(--color-text-secondary)] transition-colors hover:bg-[var(--color-primary-tint)] hover:text-[var(--color-primary)] disabled:cursor-not-allowed disabled:opacity-40"
            >
              <RotateCcw className={`h-4 w-4 ${repeatLoading ? 'animate-spin' : ''}`} />
              <span className="hidden sm:inline">{repeatLoading ? 'جاري…' : 'آخر طلب'}</span>
            </button>
            <button
              type="button"
              onClick={() => setConfirmClear(true)}
              disabled={!lines.length}
              aria-label="تفريغ السلة"
              className="flex h-11 items-center gap-1.5 rounded-[var(--radius-md)] px-2.5 text-sm font-semibold text-[var(--color-text-secondary)] transition-colors hover:bg-[var(--color-danger-tint)] hover:text-[var(--color-danger)] disabled:cursor-not-allowed disabled:opacity-40"
            >
              <Trash2 className="h-4 w-4" />
              <span className="hidden sm:inline">تفريغ</span>
            </button>
          </div>
        </div>

        {/* Order type — Polaris segmented control (desktop column only;
            mobile keeps it above the product grid). */}
        <div
          className="mt-3 hidden gap-1 rounded-[var(--radius-md)] bg-[var(--color-surface-sunken)] p-1 md:flex"
          role="group"
          aria-label="نوع الطلب"
        >
          {(
            [
              ['walkin', 'سفري'],
              ['drivethru', 'سيارة'],
              ['dinein', 'طاولة'],
            ] as const
          ).map(([value, label]) => (
            <button
              key={value}
              type="button"
              aria-pressed={type === value}
              onClick={() => onTypeChange(value)}
              disabled={submitting}
              className={cn(
                'min-h-[44px] flex-1 rounded-[6px] text-sm font-semibold transition-colors',
                type === value
                  ? 'bg-[var(--color-surface)] text-[var(--color-text)]'
                  : 'text-[var(--color-text-secondary)] hover:text-[var(--color-text)]'
              )}
            >
              {label}
            </button>
          ))}
        </div>
      </header>

      {/* Line items / empty state */}
      {lines.length === 0 ? (
        <div className="flex flex-1 flex-col items-center justify-center gap-2.5 px-6 py-12 text-center">
          <div className="flex h-12 w-12 items-center justify-center rounded-full bg-[var(--color-bg)] text-[var(--color-text-tertiary)]">
            <ShoppingBag className="h-5 w-5" strokeWidth={1.5} />
          </div>
          <p className="text-sm font-bold text-[var(--color-text-secondary)]">
            السلة فارغة
          </p>
          <p className="max-w-[200px] text-[12.5px] leading-5 text-[var(--color-text-tertiary)]">
            اضغط على أي صنف من القائمة لإضافته للطلب
          </p>
        </div>
      ) : (
        <ul className="min-h-0 flex-1 divide-y divide-[var(--color-border)] overflow-y-auto px-4">
          {lines.map((line) => (
            <CartLineItem
              key={line.key}
              line={line}
              currency={currency}
              thumbnail={thumbnails.get(line.productId)}
              onDecrement={() => onDecrement(line.key)}
              onIncrement={() => onIncrement(line.key)}
              onRemove={() => onRemove(line.key)}
              onSetQuantity={(qty) => onSetQuantity(line.key, qty)}
              onQuickAdd={(qty) => onAddQuantity(line.key, qty)}
            />
          ))}
        </ul>
      )}

      {/* Footer */}
      <footer className="shrink-0 space-y-3 border-t border-[var(--color-border)] px-4 py-4">
        <div className="field mb-0">
          <label className="label" htmlFor="pos-notes">
            ملاحظات
          </label>
          <input
            id="pos-notes"
            className="input"
            value={notes}
            onChange={(e) => {
              if (e.target.value.length <= 500) onNotesChange(e.target.value);
            }}
            placeholder="اختياري"
            maxLength={500}
          />
        </div>

        {/* Tax/discount rows intentionally omitted: pricing is server-side
            (/api/pos/order recomputes totals); client only shows subtotal. */}
        <div className="flex items-center justify-between text-sm">
          <span className="text-[var(--color-text-secondary)]">المجموع الفرعي</span>
          <span className="font-semibold tabular-nums text-[var(--color-text)]">
            {formatMoney(subtotal, currency)}
          </span>
        </div>
        <div className="flex items-baseline justify-between border-t border-[var(--color-border)] pt-3">
          <span className="text-[16px] font-extrabold text-[var(--color-text)]">
            الإجمالي
          </span>
          <span className="text-[16px] font-extrabold tabular-nums text-[var(--color-text)]" dir="ltr">
            {formatMoney(subtotal, currency)}
          </span>
        </div>

        <CheckoutButton
          loading={submitting}
          disabled={!lines.length}
          onClick={onSubmit}
        >
          {submitting ? 'جاري الإرسال…' : 'تأكيد الطلب'}
        </CheckoutButton>
      </footer>

      {/* Clear-cart confirmation — a fat-finger on "تفريغ" would wipe a
          whole order; require an explicit confirm (destructive action). */}
      {confirmClear && (
        <Modal title="تفريغ السلة" onClose={() => setConfirmClear(false)}>
          <div className="text-center">
            <div className="mx-auto mb-3 flex h-12 w-12 items-center justify-center rounded-full bg-[var(--color-danger-tint)]">
              <Trash2 className="h-6 w-6 text-[var(--color-danger)]" />
            </div>
            <p className="mb-1 text-sm font-bold">
              {itemCount} قطعة — {formatMoney(subtotal, currency)}
            </p>
            <p className="mb-5 text-xs text-[var(--color-text-secondary)]">
              هل أنت متأكد؟ هذا يمسح كل الأصناف من السلة.
            </p>
            <div className="flex gap-2">
              <button
                type="button"
                onClick={() => {
                  onClear();
                  setConfirmClear(false);
                }}
                className="min-h-[44px] flex-1 rounded-[var(--radius-md)] bg-[var(--color-danger)] px-4 text-sm font-bold text-white transition-colors hover:opacity-90"
              >
                نعم، افرغ السلة
              </button>
              <button
                type="button"
                onClick={() => setConfirmClear(false)}
                className="min-h-[44px] flex-1 rounded-[var(--radius-md)] border border-[var(--color-border)] px-4 text-sm font-bold text-[var(--color-text-secondary)] transition-colors hover:bg-[var(--color-bg)]"
              >
                إلغاء
              </button>
            </div>
          </div>
        </Modal>
      )}
    </section>
  );
}
