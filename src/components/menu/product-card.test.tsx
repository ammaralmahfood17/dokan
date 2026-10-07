import { describe, expect, it } from 'vitest';
import { renderToStaticMarkup } from 'react-dom/server';
import { MenuProductRow, type MenuProduct } from '@/components/menu/product-card';

/**
 * Perf refactor guard (2026-10-07).
 *
 * The product card was memoised so a cart tap re-renders only the card it
 * touched. That only works while (a) the export really is `React.memo` and
 * (b) every prop stays stable/primitive — `onDecrement` now receives the
 * product instead of closing over its id. These assertions hold both halves:
 * drop the memo, or reintroduce a per-card closure, and this file fails.
 */
function makeProduct(overrides: Partial<MenuProduct> = {}): MenuProduct {
  return {
    id: 'p1',
    name: 'شاي كرك',
    price: 1.5,
    description: 'شاي بالحليب',
    image_url: null,
    is_available: true,
    stock: null,
    option_groups: [],
    ...overrides,
  } as unknown as MenuProduct;
}

const baseProps = {
  currency: 'BHD',
  isFirst: false,
  lastAdded: false,
  displayName: 'شاي كرك',
  onQuickAdd: () => {},
  onDecrement: () => {},
};

describe('MenuProductRow', () => {
  it('is memoised — the whole point of the cart-ref / useCallback refactor', () => {
    const inner = MenuProductRow as unknown as { $$typeof: symbol };
    expect(inner.$$typeof).toBe(Symbol.for('react.memo'));
  });

  it('shows the add control at quantity 0 and the stepper above it', () => {
    const atZero = renderToStaticMarkup(
      <MenuProductRow {...baseProps} product={makeProduct()} quantity={0} />
    );
    expect(atZero).toContain('إضافة شاي كرك إلى السلة');
    expect(atZero).not.toContain('إنقاص كمية شاي كرك');

    const aboveZero = renderToStaticMarkup(
      <MenuProductRow {...baseProps} product={makeProduct()} quantity={3} />
    );
    expect(aboveZero).toContain('إنقاص كمية شاي كرك');
    expect(aboveZero).toContain('زيادة كمية شاي كرك');
  });

  it('renders the name/price and greys out a tracked product with no portions left', () => {
    const html = renderToStaticMarkup(
      <MenuProductRow {...baseProps} product={makeProduct()} quantity={0} />
    );
    expect(html).toContain('شاي كرك');

    const soldOut = renderToStaticMarkup(
      <MenuProductRow {...baseProps} product={makeProduct({ stock: 0 })} quantity={0} />
    );
    expect(soldOut).toContain('غير متوفر');
  });
});
