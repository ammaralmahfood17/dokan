import { Minus, Plus, Trash2 } from 'lucide-react';
import { formatMoney } from '@/lib/utils';
import type { PosLine } from './types';

/**
 * Polaris-style cart line: thumbnail, name (+ addons), qty stepper (+/-),
 * line total, remove. All interactive controls are ≥44px touch targets.
 * The quantity is an editable number input (desktop) so a cashier can
 * type "10" instead of tapping + ten times.
 */
export function CartLineItem({
  line,
  currency,
  thumbnail,
  onDecrement,
  onIncrement,
  onRemove,
  onSetQuantity,
  onQuickAdd,
}: {
  line: PosLine;
  currency: string;
  thumbnail?: string | null;
  onDecrement: () => void;
  onIncrement: () => void;
  onRemove: () => void;
  onSetQuantity?: (qty: number) => void;
  /** UX-U13: إضافة كمية دفعة واحدة (+2/+5) */
  onQuickAdd?: (qty: number) => void;
}) {
  return (
    <li data-pos-line className="flex items-start gap-3 py-3">
      {thumbnail ? (
        // eslint-disable-next-line @next/next/no-img-element
        <img
          src={thumbnail}
          alt=""
          className="mt-0.5 h-11 w-11 shrink-0 rounded-[var(--radius-md)] border border-[var(--color-border)] bg-[var(--color-surface-sunken)] object-cover"
        />
      ) : (
        <span className="mt-0.5 flex h-11 w-11 shrink-0 items-center justify-center rounded-[var(--radius-md)] bg-[var(--color-surface-sunken)] text-[var(--color-text-secondary)]">
          🍽️
        </span>
      )}

      <div className="min-w-0 flex-1">
        <div className="flex items-start justify-between gap-2">
          <div className="min-w-0">
            <p className="truncate text-sm font-semibold text-[var(--color-text)]">
              {line.productName}
            </p>
            {line.addonLabels.length > 0 && (
              <p className="mt-0.5 truncate text-xs text-[var(--color-text-secondary)]">
                {line.addonLabels.join(' · ')}
              </p>
            )}
          </div>
          <p className="shrink-0 text-sm font-semibold tabular-nums text-[var(--color-text)]">
            {formatMoney(line.unitPrice * line.quantity, currency)}
          </p>
        </div>

        <div className="mt-2 flex items-center justify-between gap-2">
          <div className="flex items-center rounded-full bg-[var(--color-bg)] p-1">
            <button
              type="button"
              onClick={onDecrement}
              aria-label={`تقليل كمية ${line.productName}`}
              className="flex h-11 w-11 items-center justify-center rounded-full text-[var(--color-text-secondary)] transition-colors hover:bg-[var(--color-surface)] hover:text-[var(--color-text)]"
            >
              <Minus className="h-4 w-4" />
            </button>
            {onSetQuantity ? (
              <input
                type="number"
                inputMode="numeric"
                min={1}
                max={999}
                value={line.quantity}
                onChange={(e) => {
                  const n = Number(e.target.value);
                  if (Number.isFinite(n) && n >= 1 && n <= 999) onSetQuantity(Math.floor(n));
                }}
                aria-label={`كمية ${line.productName}`}
                className="w-12 border-0 bg-transparent text-center text-sm font-bold tabular-nums text-[var(--color-text)] outline-none"
              />
            ) : (
              <span
                className="w-9 text-center text-sm font-bold tabular-nums text-[var(--color-text)]"
                aria-live="polite"
              >
                {line.quantity}
              </span>
            )}
            <button
              type="button"
              onClick={onIncrement}
              aria-label={`زيادة كمية ${line.productName}`}
              className="flex h-11 w-11 items-center justify-center rounded-full text-[var(--color-text-secondary)] transition-colors hover:bg-[var(--color-surface)] hover:text-[var(--color-text)]"
            >
              <Plus className="h-4 w-4" />
            </button>
          </div>
          {/* UX-U13: كميات سريعة — الكاشير يضيف 2/5 بلمسة واحدة بدل التكرار */}
          {onQuickAdd && (
            <div className="flex items-center gap-1">
              {[2, 5].map((n) => (
                <button
                  key={n}
                  type="button"
                  onClick={() => onQuickAdd(n)}
                  aria-label={`أضف ${n} إلى كمية ${line.productName}`}
                  className="flex h-11 min-w-[40px] items-center justify-center rounded-[var(--radius-md)] border border-[var(--color-border)] px-2 text-[12px] font-bold tabular-nums text-[var(--color-text-secondary)] transition-colors hover:border-[var(--color-primary)] hover:text-[var(--color-primary)] active:bg-[var(--color-primary-tint)]"
                >
                  +{n}
                </button>
              ))}
            </div>
          )}
          <button
            type="button"
            onClick={onRemove}
            aria-label={`حذف ${line.productName} من السلة`}
            className="flex h-11 w-11 items-center justify-center rounded-[var(--radius-md)] text-[var(--color-text-secondary)] transition-colors hover:bg-[var(--color-danger-tint)] hover:text-[var(--color-danger)]"
          >
            <Trash2 className="h-4 w-4" />
          </button>
        </div>
      </div>
    </li>
  );
}
