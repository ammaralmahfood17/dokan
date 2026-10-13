'use client';

import { ArrowUpDown, CalendarDays, Search, X } from 'lucide-react';
import { toDateKey, type SortKey } from '@/lib/order-filters';

/**
 * The orders page's controls: day navigation, instant search, sort. Extracted
 * verbatim from `orders-client.tsx` (architecture review 2026-10-13, wave 4) —
 * markup only, no behaviour of its own.
 */
export function OrdersToolbar({
  dateKey,
  isToday,
  onSelectDate,
  onSelectDayOffset,
  query,
  onQueryChange,
  sortBy,
  onSortChange,
}: {
  dateKey: string;
  isToday: boolean;
  onSelectDate: (key: string) => void;
  onSelectDayOffset: (offsetDays: number) => void;
  query: string;
  onQueryChange: (value: string) => void;
  sortBy: SortKey;
  onSortChange: (value: SortKey) => void;
}) {
  return (
    <>
      {/* Date picker — اليوم/أمس + تقويم (لا مستقبل) */}
      <div className="mb-4 flex flex-wrap items-center gap-1.5">
        <button
          type="button"
          onClick={() => onSelectDayOffset(0)}
          aria-pressed={isToday}
          className={`flex min-h-[44px] items-center rounded-full px-4 text-xs font-bold transition-colors ${
            isToday
              ? 'bg-[var(--color-primary)] text-white'
              : 'border border-[var(--color-border)] bg-[var(--color-surface)] text-[var(--color-text-secondary)] hover:border-[var(--color-primary)]'
          }`}
        >
          اليوم
        </button>
        <button
          type="button"
          onClick={() => onSelectDayOffset(-1)}
          className="flex min-h-[44px] items-center rounded-full border border-[var(--color-border)] bg-[var(--color-surface)] px-4 text-xs font-bold text-[var(--color-text-secondary)] transition-colors hover:border-[var(--color-primary)]"
        >
          أمس
        </button>
        <label className="flex min-h-[44px] cursor-pointer items-center gap-1.5 rounded-full border border-[var(--color-border)] bg-[var(--color-surface)] px-3 text-xs font-semibold text-[var(--color-text-secondary)]">
          <CalendarDays className="h-4 w-4" aria-hidden="true" />
          <input
            type="date"
            value={dateKey}
            max={toDateKey(new Date())}
            onChange={(e) => {
              if (e.target.value) onSelectDate(e.target.value);
            }}
            className="bg-transparent text-xs font-semibold outline-none"
            aria-label="اختيار تاريخ"
          />
        </label>
      </div>

      {/* بحث فوري + فرز */}
      <div className="mb-4 flex flex-wrap items-center gap-2">
        <div className="relative min-w-[200px] flex-1">
          <Search className="pointer-events-none absolute start-3 top-1/2 h-4 w-4 -translate-y-1/2 text-[var(--color-text-muted)]" />
          <input
            type="search"
            inputMode="search"
            value={query}
            onChange={(e) => onQueryChange(e.target.value)}
            placeholder="ابحث برقم الطلب أو المنتج أو الطاولة…"
            aria-label="ابحث في الطلبات"
            maxLength={60}
            className="input min-h-[44px] w-full ps-10! pe-10!"
          />
          {query && (
            <button
              type="button"
              onClick={() => onQueryChange('')}
              aria-label="مسح البحث"
              className="absolute end-0 top-1/2 flex h-11 w-11 -translate-y-1/2 items-center justify-center rounded-full text-[var(--color-text-muted)] hover:bg-[var(--color-surface-sunken)]"
            >
              <X className="h-4 w-4" />
            </button>
          )}
        </div>
        <label className="flex min-h-[44px] cursor-pointer items-center gap-1.5 rounded-full border border-[var(--color-border)] bg-[var(--color-surface)] px-3 text-xs font-semibold text-[var(--color-text-secondary)]">
          <ArrowUpDown className="h-3.5 w-3.5" />
          <select
            value={sortBy}
            onChange={(e) => onSortChange(e.target.value as SortKey)}
            aria-label="ترتيب الطلبات"
            className="bg-transparent text-xs font-semibold outline-none"
          >
            <option value="newest">الأحدث</option>
            <option value="oldest">الأقدم</option>
            <option value="amount">الأعلى مبلغًا</option>
          </select>
        </label>
      </div>
    </>
  );
}
