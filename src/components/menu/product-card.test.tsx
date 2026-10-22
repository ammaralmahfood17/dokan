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
  onAddWithChoice: () => {},
  onDecrement: () => {},
};

/** A free add-on group («إضافات»: نعناع / حبق) and a paid one. */
function addonGroup(free: boolean) {
  return {
    id: 'g-addons',
    product_id: 'p1',
    name: 'إضافات',
    name_en: null,
    min_select: 0,
    max_select: 3,
    sort_order: 1,
    option_choices: [
      {
        id: 'mint',
        group_id: 'g-addons',
        name: 'نعناع',
        name_en: null,
        price: 0,
        is_available: true,
        sort_order: 0,
      },
      {
        id: 'basil',
        group_id: 'g-addons',
        name: 'حبق',
        name_en: null,
        price: free ? 0 : 0.1,
        is_available: true,
        sort_order: 1,
      },
    ],
  };
}

function sizeGroup() {
  return {
    id: 'g-size',
    product_id: 'p1',
    name: 'الحجم',
    name_en: null,
    min_select: 1,
    max_select: 1,
    sort_order: 0,
    option_choices: [
      {
        id: 'cup',
        group_id: 'g-size',
        name: 'استكانة',
        name_en: null,
        price: 0,
        is_available: true,
        sort_order: 0,
      },
    ],
  };
}

describe('MenuProductRow', () => {
  it('shows the free add-ons on the card, before the sheet is opened', () => {
    const html = renderToStaticMarkup(
      <MenuProductRow
        {...baseProps}
        product={makeProduct({ option_groups: [sizeGroup(), addonGroup(true)] as never })}
        quantity={0}
      />
    );
    expect(html).toContain('aria-label="إضافة شاي كرك مع نعناع"');
    expect(html).toContain('aria-label="إضافة شاي كرك مع حبق"');
  });

  it('hints «إضافات» but shows no chip when every optional variety is PAID', () => {
    // Paid varieties stay inside the sheet (the total is live there); the card
    // must still say the product can be customised.
    const paidOnly = addonGroup(false);
    paidOnly.option_choices = paidOnly.option_choices.map((c) => ({ ...c, price: 0.1 }));
    const html = renderToStaticMarkup(
      <MenuProductRow
        {...baseProps}
        product={makeProduct({ option_groups: [paidOnly] as never })}
        quantity={0}
      />
    );
    expect(html).toContain('إضافات');
    expect(html).not.toContain('chip-addon');
  });

  it('renders no add-on hint for a product whose only group is required', () => {
    const html = renderToStaticMarkup(
      <MenuProductRow
        {...baseProps}
        product={makeProduct({ option_groups: [sizeGroup()] as never })}
        quantity={0}
      />
    );
    expect(html).not.toContain('chip-addon');
    expect(html).not.toContain('إضافات');
  });

  it('hides the chips on a sold-out product', () => {
    const html = renderToStaticMarkup(
      <MenuProductRow
        {...baseProps}
        product={makeProduct({ option_groups: [addonGroup(true)] as never, is_available: false })}
        quantity={0}
      />
    );
    expect(html).not.toContain('chip-addon');
  });

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
