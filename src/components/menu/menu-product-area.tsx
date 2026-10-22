'use client';

import { Search, X, Languages } from 'lucide-react';
import type { ReactNode, RefObject } from 'react';
import type { Category, ProductWithOptions } from '@/lib/types';

/**
 * The browse area: search + language toggle, then the products — grouped under
 * their category on «الكل», or as one flat grid inside a chosen category.
 *
 * Extracted verbatim from `menu-client.tsx` (architecture review 2026-10-13,
 * wave 4 phase b).
 *
 * Two deliberate hand-offs keep this presentational:
 *  - `renderProduct` comes from the caller, because the card is memoised and the
 *    handlers behind it must keep the identity the client already tuned;
 *  - `isFirst` is passed through so the first card of the first section can be
 *    the priority-rendered one (LCP), including when the list is uncategorized.
 */
export function MenuProductArea({
  mainRef,
  showSearch,
  query,
  onQueryChange,
  lang,
  showLangToggle,
  onToggleLang,
  filtered,
  activeCategory,
  visibleCategories,
  productsByCategory,
  uncategorized,
  categories,
  renderProduct,
}: {
  mainRef: RefObject<HTMLElement | null>;
  showSearch: boolean;
  query: string;
  onQueryChange: (value: string) => void;
  lang: 'ar' | 'en';
  showLangToggle: boolean;
  onToggleLang: () => void;
  filtered: ProductWithOptions[];
  activeCategory: string | 'all';
  visibleCategories: Category[];
  productsByCategory: Map<string, ProductWithOptions[]>;
  uncategorized: ProductWithOptions[];
  categories: Category[];
  renderProduct: (product: ProductWithOptions, isFirst?: boolean) => ReactNode;
}) {
  return (
    <main ref={mainRef} className="menu-shell px-3 py-4">
      {/* Search + language toggle — search only for big menus */}
      <div className="mb-4 flex items-center gap-2">
        {showSearch && (
          <div className="relative min-w-0 flex-1">
            <Search className="pointer-events-none absolute start-3 top-1/2 h-4 w-4 -translate-y-1/2 text-[var(--color-text-muted)]" />
            <input
              type="search"
              inputMode="search"
              value={query}
              onChange={(e) => onQueryChange(e.target.value)}
              placeholder="ابحث عن منتج…"
              aria-label="ابحث في القائمة"
              maxLength={60}
              className="input min-h-[44px] w-full ps-10! pe-10!"
              style={{ borderRadius: 'var(--radius-md)' }}
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
        )}
        {showLangToggle && (
          <button
            type="button"
            // audit T1 #8 (WCAG 3.1.2): the visible content switches language, so the document
            // has to say which one it is. dir stays rtl - the layout is RTL-first by design.
            onClick={onToggleLang}
            aria-label={lang === 'ar' ? 'التبديل إلى الإنجليزية' : 'Switch to Arabic'}
            aria-pressed={lang === 'en'}
            className="flex h-[44px] shrink-0 items-center gap-1.5 rounded-[var(--radius-md)] border border-[var(--color-border)] bg-[var(--color-surface)] px-3 text-xs font-bold text-[var(--color-text-secondary)] transition-colors hover:border-[var(--color-primary)]"
          >
            <Languages className="h-4 w-4" />
            {lang === 'ar' ? 'EN' : 'عربي'}
          </button>
        )}
      </div>

      {!filtered.length ? (
        query.trim() ? (
          /* v1.1 Calm Surface mockup — signature empty search state */
          <div className="flex flex-col items-center gap-2.5 px-8 py-14 text-center">
            <div className="mb-1 flex h-[52px] w-[52px] items-center justify-center rounded-full bg-[var(--color-primary-tint)] text-[var(--color-primary)]">
              <Search className="h-[22px] w-[22px]" />
            </div>
            <p className="text-[15px] font-bold">ما حصلنا شي يطابق بحثك</p>
            <p className="max-w-[240px] text-[13px] text-[var(--color-text-secondary)]">
              جرّب كلمة ثانية، أو تصفّح الأقسام من الأعلى
            </p>
            <button
              type="button"
              onClick={() => onQueryChange('')}
              className="mt-1.5 rounded-[var(--radius-md)] px-3 py-2 text-[13px] font-bold text-[var(--color-primary)] transition-colors hover:bg-[var(--color-primary-tint)]"
            >
              مسح البحث
            </button>
          </div>
        ) : (
          <div className="card empty">
            <h3>القائمة فارغة</h3>
            <p className="text-sm">لا توجد منتجات متاحة حالياً.</p>
          </div>
        )
      ) : (
        <>
          {activeCategory === 'all' ? (
            /* All categories: group products under each category */
            <>
              {visibleCategories.map((cat, catIdx) => {
                const catProducts = productsByCategory.get(cat.id) ?? [];
                if (!catProducts.length) return null;
                return (
                  <section key={cat.id} className="mb-6">
                    <div className="mb-3">
                      <h2 className="font-display text-[15.5px] font-bold">{cat.name}</h2>
                      <p className="mt-0.5 text-[12.5px] text-[var(--color-text-tertiary)]">
                        {catProducts.length} {catProducts.length === 1 ? 'صنف' : 'أصناف'}
                      </p>
                    </div>
                    <div className="grid grid-cols-2 gap-3 min-[480px]:grid-cols-3 lg:grid-cols-4">
                      {catProducts.map((p, idx) => renderProduct(p, idx === 0 && catIdx === 0))}
                    </div>
                  </section>
                );
              })}
              {/* Uncategorized products (category deleted → SET NULL): keep them visible */}
              {uncategorized.length > 0 && (
                <section className="mb-6">
                  <div className="mb-3">
                    <h2 className="font-display text-[15.5px] font-bold">بدون تصنيف</h2>
                    <p className="mt-0.5 text-[12.5px] text-[var(--color-text-tertiary)]">
                      {uncategorized.length} {uncategorized.length === 1 ? 'صنف' : 'أصناف'}
                    </p>
                  </div>
                  <div className="grid grid-cols-2 gap-3 min-[480px]:grid-cols-3 lg:grid-cols-4">
                    {uncategorized.map((p, idx) => renderProduct(p, idx === 0 && categories.length === 0))}
                  </div>
                </section>
              )}
            </>
          ) : (
            /* Single category: flat list */
            <div className="grid grid-cols-2 gap-3 min-[480px]:grid-cols-3 lg:grid-cols-4">
              {filtered.map((p, idx) => renderProduct(p, idx === 0))}
            </div>
          )}
        </>
      )}
    </main>
  );
}
