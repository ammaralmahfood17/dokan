'use client';

import type { Category } from '@/lib/types';

/**
 * The category pills. Extracted verbatim from `menu-client.tsx` (architecture
 * review 2026-10-13, wave 4 phase b).
 *
 * The active pill is filled with the brand colour; the strip scrolls
 * horizontally with a mask fade on the leading edge (FIX-R-003) so it is
 * visible that there is more to the side of the visible pills.
 */
export function MenuCategoryPills({
  categories,
  activeCategory,
  onSelect,
}: {
  categories: Category[];
  activeCategory: string | 'all';
  onSelect: (categoryId: string | 'all') => void;
}) {
  const pill = (isActive: boolean) =>
    `min-h-[44px] shrink-0 whitespace-nowrap rounded-full px-4 text-[13px] font-semibold transition-colors ${
      isActive
        ? 'bg-[var(--color-primary)] text-white'
        : 'border border-[var(--color-border-strong)] bg-[var(--color-surface)] text-[var(--color-text-secondary)] hover:border-[var(--color-text-tertiary)] hover:text-[var(--color-text)]'
    }`;

  return (
    <div className="sticky top-[57px] z-[var(--z-sticky)] border-b border-[var(--color-border)] bg-[var(--color-bg)]">
      {/* FIX-R-003: fade على الحواف يشير لوجود محتوى إضافي (scrollbar مخفي) */}
      <div
        className="mx-auto flex max-w-[480px] gap-2 overflow-x-auto px-3 pb-1 pt-1"
        style={{
          scrollbarWidth: 'none',
          maskImage: 'linear-gradient(to left, transparent, black 24px)',
          WebkitMaskImage: 'linear-gradient(to left, transparent, black 24px)',
        }}
      >
        <button type="button" onClick={() => onSelect('all')} className={pill(activeCategory === 'all')}>
          الكل
        </button>
        {categories.map((c) => (
          <button key={c.id} type="button" onClick={() => onSelect(c.id)} className={pill(activeCategory === c.id)}>
            {c.name}
          </button>
        ))}
      </div>
    </div>
  );
}
