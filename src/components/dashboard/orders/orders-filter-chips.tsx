'use client';

import { FILTERS } from '@/lib/order-filters';
import type { StatusCounts } from '@/lib/order-stats';
import type { OrderStatus } from '@/lib/types';

/**
 * The status chips, each carrying a live count from the FULL-DAY read (not from
 * the loaded page — see use-orders-feed). Extracted verbatim from
 * `orders-client.tsx` (architecture review 2026-10-13, wave 4).
 */
export function OrdersFilterChips({
  filter,
  counts,
  onFilterChange,
}: {
  filter: OrderStatus | 'all';
  counts: StatusCounts;
  onFilterChange: (value: OrderStatus | 'all') => void;
}) {
  return (
    <div className="mb-4 flex flex-wrap gap-1.5">
      {FILTERS.map((f) => (
        <button
          key={f.value}
          type="button"
          onClick={() => onFilterChange(f.value)}
          aria-pressed={filter === f.value}
          className={`flex min-h-[44px] items-center gap-1.5 rounded-full px-3 py-1 text-xs font-bold transition-colors ${
            filter === f.value
              ? 'bg-[var(--color-primary)] text-white'
              : 'bg-[var(--color-surface)] text-[var(--color-text-secondary)] border border-[var(--color-border)]'
          }`}
        >
          {f.label}
          <span
            className={`rounded-full px-1.5 py-0.5 text-[11.5px] tabular-nums ${
              filter === f.value
                ? 'bg-white/20 text-white'
                : 'bg-[var(--color-bg)] text-[var(--color-text-muted)]'
            }`}
          >
            {counts[f.value]}
          </span>
        </button>
      ))}
    </div>
  );
}
