'use client';

import { Search, X } from 'lucide-react';
import type { RefObject } from 'react';
import { ProductCard } from '@/components/pos/product-card';
import type { OrderType, Product, ProductWithOptions } from '@/lib/types';

const ORDER_TYPES: [OrderType, string][] = [
  ['dinein', 'طاولة'],
  ['walkin', 'سفري'],
  ['drivethru', 'سيارة'],
];

/**
 * The POS left column: the mobile order-type switch, the cashier search, and
 * the product grid.
 *
 * Extracted verbatim from `pos-client.tsx` (architecture review 2026-10-13,
 * wave 4 phase b).
 *
 * audit T1 #15: the order-type buttons are FILTER buttons over one visible
 * region, not tabs with panels — `role="tab"` without panels is a
 * half-implemented pattern axe flags (aria-required-children), so they carry
 * `aria-pressed` like the app's other filters.
 */
export function PosProductGrid({
  type,
  onTypeChange,
  submitting,
  query,
  onQueryChange,
  onSearchKeyDown,
  searchRef,
  products,
  categories = [],
  category,
  onCategoryChange,
  queryIsActive,
  currency,
  onSelect,
}: {
  type: OrderType;
  onTypeChange: (value: OrderType) => void;
  submitting: boolean;
  query: string;
  onQueryChange: (value: string) => void;
  onSearchKeyDown: (e: React.KeyboardEvent<HTMLInputElement>) => void;
  searchRef: RefObject<HTMLInputElement | null>;
  products: ProductWithOptions[];
  /** Menu categories for the cashier filter (UX-17); empty = no chips rendered. */
  categories?: { id: string; name: string }[];
  category: string | null;
  onCategoryChange: (id: string | null) => void;
  /** The trimmed query — decides which empty state to show. */
  queryIsActive: boolean;
  currency: string;
  /** The card hands back a `Product`; the caller narrows it to the loaded row. */
  onSelect: (product: Product) => void;
}) {
  return (
    <div className="min-w-0">
      {/* Mobile order type — desktop keeps it in the cart header */}
      <div
        className="mb-3 flex gap-1 rounded-[var(--radius-md)] bg-[var(--color-surface-sunken)] p-1 md:hidden"
        role="group"
        aria-label="نوع الطلب"
      >
        {ORDER_TYPES.map(([value, label]) => (
          <button
            key={value}
            type="button"
            aria-pressed={type === value}
            onClick={() => onTypeChange(value)}
            disabled={submitting}
            className={`min-h-[44px] flex-1 rounded-[6px] text-sm font-semibold transition-colors ${
              type === value
                ? 'bg-[var(--color-surface)] text-[var(--color-text)]'
                : 'text-[var(--color-text-secondary)] hover:text-[var(--color-text)]'
            }`}
          >
            {label}
          </button>
        ))}
      </div>

      {/* Cashier search — desktop "/" shortcut, Enter quick-adds top hit */}
      <div className="relative mb-3">
        <Search className="pointer-events-none absolute start-3 top-1/2 h-4 w-4 -translate-y-1/2 text-[var(--color-text-muted)]" />
        <input
          ref={searchRef}
          type="search"
          inputMode="search"
          value={query}
          onChange={(e) => onQueryChange(e.target.value)}
          onKeyDown={onSearchKeyDown}
          placeholder="ابحث عن منتج… ( / )"
          aria-label="ابحث عن منتج"
          maxLength={60}
          className="input min-h-[44px] w-full ps-10! pe-12!"
          style={{ borderRadius: 'var(--radius-md)' }}
        />
        {query && (
          <button
            type="button"
            onClick={() => onQueryChange('')}
            aria-label="مسح البحث"
            className="absolute end-0 top-1/2 flex h-11 w-11 -translate-y-1/2 items-center justify-center rounded-full text-[var(--color-text-muted)] hover:bg-[var(--color-surface-sunken)] hover:text-[var(--color-text)]"
          >
            <X className="h-4 w-4" />
          </button>
        )}
      </div>

      {/* Category filter — the menu's own categories, so a cashier reaches «شاي كرك»
          in one tap instead of scrolling a 30-item grid (UX-17). */}
      {categories.length > 0 && (
        <div
          className="mb-3 flex gap-2 overflow-x-auto pb-1"
          role="group"
          aria-label="تصنيفات المنتجات"
        >
          {[{ id: null, name: 'الكل' }, ...categories].map((c) => {
            const active = category === c.id;
            return (
              <button
                key={c.id ?? 'all'}
                type="button"
                onClick={() => onCategoryChange(c.id)}
                aria-pressed={active}
                className={`min-h-[44px] shrink-0 whitespace-nowrap rounded-full border px-4 text-[13px] font-semibold transition-colors ${
                  active
                    ? 'border-[var(--color-primary)] bg-[var(--color-primary-tint)] text-[var(--color-primary)]'
                    : 'border-[var(--color-border)] bg-[var(--color-surface)] text-[var(--color-text-secondary)]'
                }`}
              >
                {c.name}
              </button>
            );
          })}
        </div>
      )}

      {!products.length ? (
        <div className="card empty">
          <h3>{queryIsActive ? 'لا توجد نتائج مطابقة' : 'ما فيه منتجات متاحة حالياً'}</h3>
          <p className="text-sm">
            {queryIsActive ? `لا يوجد منتج باسم «${query.trim()}».` : 'أضف منتجاتك من صفحة المنتجات.'}
          </p>
        </div>
      ) : (
        <div
          data-pos-grid
          className="grid grid-cols-[repeat(auto-fill,minmax(140px,1fr))] gap-3"
        >
          {products.map((p) => (
            <ProductCard key={p.id} product={p} currency={currency} onSelect={onSelect} />
          ))}
        </div>
      )}
    </div>
  );
}
