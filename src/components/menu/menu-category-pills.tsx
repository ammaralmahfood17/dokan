'use client';

import { FilterPill } from '@/components/ui/filter-pill';
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
  return (
    <div className="sticky top-[57px] z-[var(--z-sticky)] border-b border-[var(--color-border)] bg-[var(--color-bg)]">
      {/* FIX-R-003: fade على الحواف يشير لوجود محتوى إضافي (scrollbar مخفي) */}
      <div
        className="menu-shell flex gap-2 overflow-x-auto px-3 pb-1 pt-1"
        style={{
          scrollbarWidth: 'none',
          maskImage: 'linear-gradient(to left, transparent, black 24px)',
          WebkitMaskImage: 'linear-gradient(to left, transparent, black 24px)',
        }}
      >
        <FilterPill active={activeCategory === 'all'} onClick={() => onSelect('all')}>
          الكل
        </FilterPill>
        {categories.map((c) => (
          <FilterPill key={c.id} active={activeCategory === c.id} onClick={() => onSelect(c.id)}>
            {c.name}
          </FilterPill>
        ))}
      </div>
    </div>
  );
}
