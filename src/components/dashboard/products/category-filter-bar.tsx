'use client';

// FIX-C-003 (audit 2.4): CategoryFilterBar — extracted verbatim from
// products-client.tsx. Search input (deferred value owned by the parent) +
// category chips with live counts and inline edit/delete entry points.
// No behavior change.
import { X, Search, Pencil, Trash2 } from 'lucide-react';
import type { Category } from '@/lib/types';

export function CategoryFilterBar({
  searchQuery,
  onSearchChange,
  activeCat,
  onPickCat,
  categories,
  totalCount,
  counts,
  onEditCategory,
  onDeleteCategory,
}: {
  searchQuery: string;
  onSearchChange: (q: string) => void;
  activeCat: string | null;
  onPickCat: (id: string | null) => void;
  categories: Category[];
  totalCount: number;
  counts: Map<string, number>;
  onEditCategory: (c: Category) => void;
  onDeleteCategory: (c: Category) => void;
}) {
  return (
    <>
      {/* Search bar */}
      <div className="relative mb-4">
        <Search className="pointer-events-none absolute start-3.5 top-1/2 h-4 w-4 -translate-y-1/2 text-[var(--color-text-muted)]" />
        <input
          className="input ps-10! pe-12!"
          placeholder="ابحث عن منتج…"
          maxLength={100}
          value={searchQuery}
          onChange={(e) => onSearchChange(e.target.value)}
        />
        {searchQuery && (
          <button
            type="button"
            onClick={() => onSearchChange('')}
            className="absolute end-2 top-1/2 -translate-y-1/2 btn btn-ghost btn-sm"
            aria-label="مسح البحث"
          >
            <X className="h-3.5 w-3.5" />
          </button>
        )}
      </div>

      {categories.length > 0 && (
        <div className="mb-4 flex flex-wrap items-center gap-1.5">
          <button
            type="button"
            onClick={() => onPickCat(null)}
            aria-pressed={!activeCat}
            className={`flex min-h-[44px] items-center gap-1.5 rounded-full px-4 text-xs font-bold transition-all ${
              !activeCat
                ? 'bg-[var(--color-primary)] text-white'
                : 'border border-[var(--color-border)] bg-[var(--color-surface)] text-[var(--color-text-secondary)] hover:border-[var(--color-primary)]'
            }`}
          >
            <span>الكل</span>
            <span
              className={`rounded-full px-1.5 py-0.5 text-[11.5px] tabular-nums ${
                !activeCat ? 'bg-white/20' : 'bg-[var(--color-bg)]'
              }`}
            >
              {totalCount}
            </span>
          </button>
          {categories.map((c) => (
            <div
              key={c.id}
              className={`flex min-h-[44px] items-center gap-0.5 rounded-full py-1 pe-1 ps-3 text-xs font-bold transition-all ${
                activeCat === c.id
                  ? 'bg-[var(--color-primary)] text-white'
                  : 'border border-[var(--color-border)] bg-[var(--color-surface)] text-[var(--color-text-secondary)]'
              }`}
            >
              <button
                type="button"
                onClick={() => onPickCat(activeCat === c.id ? null : c.id)}
                aria-pressed={activeCat === c.id}
                className="flex items-center gap-1.5 rounded-full py-1.5"
              >
                {c.name}
                <span
                  className={`rounded-full px-1.5 py-0.5 text-[11.5px] tabular-nums ${
                    activeCat === c.id ? 'bg-white/20' : 'bg-[var(--color-bg)]'
                  }`}
                >
                  {counts.get(c.id) ?? 0}
                </span>
              </button>
              {/* Edit/delete — real buttons, always visible (touch + keyboard) */}
              <span className="mx-0.5 h-4 w-px bg-[var(--color-border)]" aria-hidden="true" />
              <button
                type="button"
                onClick={() => onEditCategory(c)}
                aria-label={`تعديل التصنيف ${c.name}`}
                className="flex min-h-[44px] min-w-[44px] items-center justify-center rounded-full transition-opacity hover:opacity-70"
              >
                <Pencil className="h-3 w-3" />
              </button>
              <button
                type="button"
                onClick={() => onDeleteCategory(c)}
                aria-label={`حذف التصنيف ${c.name}`}
                className="flex min-h-[44px] min-w-[44px] items-center justify-center rounded-full transition-opacity hover:opacity-70"
              >
                <Trash2 className="h-3 w-3 text-[var(--color-danger)]" />
              </button>
            </div>
          ))}
        </div>
      )}
    </>
  );
}
