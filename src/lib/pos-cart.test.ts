import { describe, expect, it } from 'vitest';
import {
  addPosLine,
  availablePosProducts,
  buildPosLine,
  changePosQty,
  posLineKey,
  posStockCheck,
  searchPosProducts,
  filterPosByCategory,
  setPosQty,
  type PosLineLike,
} from './pos-cart';
import { cartTotal } from './menu-cart';
import type { ProductOptionChoice, ProductOptionGroup, ProductWithOptions } from './types';

/**
 * The POS cart rules. The cashier is the fastest user in the product (a queue
 * is watching), so the two checks that must never be wrong are the stock cap —
 * the SERVER rejects the whole order at checkout, so a miss here is a failed
 * sale in front of a customer — and the merge rule, so re-ringing the same
 * configuration stacks instead of splitting the line.
 */

function choice(id: string, price = 0, is_available = true): ProductOptionChoice {
  return { id, group_id: 'g1', name: `c-${id}`, name_en: null, price, is_available, sort_order: 0 };
}

function group(over: Partial<ProductOptionGroup> = {}): ProductOptionGroup {
  return {
    id: 'g1',
    product_id: 'p1',
    name: 'الحجم',
    name_en: null,
    min_select: 0,
    max_select: 1,
    sort_order: 0,
    option_choices: [choice('c1', 0.5)],
    ...over,
  };
}

function product(over: Partial<ProductWithOptions> = {}): ProductWithOptions {
  return {
    id: 'p1',
    project_id: 'pr',
    category_id: null,
    name: 'لاتيه',
    name_en: 'Latte',
    description: null,
    price: 1.5,
    image_url: null,
    is_available: true,
    sort_order: 0,
    created_at: '2026-10-13T00:00:00Z',
    stock: null,
    option_groups: [],
    ...over,
  } as ProductWithOptions;
}

function posLine(over: Partial<PosLineLike> = {}): PosLineLike {
  return {
    key: 'p1:',
    productId: 'p1',
    productName: 'لاتيه',
    unitPrice: 1.5,
    quantity: 1,
    optionIds: [],
    addonLabels: [],
    ...over,
  };
}

describe('posLineKey', () => {
  it('ignores the order the varieties were tapped in', () => {
    expect(posLineKey('p1', ['b', 'a'])).toBe(posLineKey('p1', ['a', 'b']));
  });

  it('distinguishes a configuration from the plain product', () => {
    expect(posLineKey('p1', [])).not.toBe(posLineKey('p1', ['c1']));
  });
});

describe('availablePosProducts', () => {
  const products = [
    product({ id: 'a', sort_order: 2 }),
    product({ id: 'b', sort_order: 0 }),
    product({ id: 'c', sort_order: 1, is_available: false }),
    product({ id: 'd', sort_order: 3, stock: 0 }),
  ];

  it('drops unavailable and sold-out products', () => {
    expect(availablePosProducts(products).map((p) => p.id)).toEqual(['b', 'a']);
  });

  it('puts the most-ordered first and sorts ties by sort_order', () => {
    expect(availablePosProducts(products, { a: 5 }).map((p) => p.id)).toEqual(['a', 'b']);
    expect(availablePosProducts(products, { a: 5, b: 5 }).map((p) => p.id)).toEqual(['b', 'a']);
  });

  it('never mutates the array it was given', () => {
    const before = products.map((p) => p.id);
    availablePosProducts(products, { a: 9 });
    expect(products.map((p) => p.id)).toEqual(before);
  });
});

describe('filterPosByCategory', () => {
  const items = [
    { id: 'a', category_id: 'hot' },
    { id: 'b', category_id: 'cold' },
    { id: 'c', category_id: null },
  ];

  it('is the identity filter for «الكل»', () => {
    expect(filterPosByCategory(items, null)).toHaveLength(3);
  });

  it('keeps only the requested category', () => {
    expect(filterPosByCategory(items, 'hot').map((p) => p.id)).toEqual(['a']);
  });

  it('returns an empty list for an unknown category instead of everything', () => {
    expect(filterPosByCategory(items, 'deleted')).toEqual([]);
  });
});

describe('searchPosProducts', () => {
  const products = [
    product({ id: 'a', name: 'لاتيه', name_en: 'Latte' }),
    product({ id: 'b', name: 'شاي', name_en: null }),
  ];

  it('searches both languages', () => {
    expect(searchPosProducts(products, 'lat').map((p) => p.id)).toEqual(['a']);
    expect(searchPosProducts(products, 'شا').map((p) => p.id)).toEqual(['b']);
  });

  it('returns everything for a blank query', () => {
    expect(searchPosProducts(products, '   ')).toHaveLength(2);
  });
});

describe('posStockCheck', () => {
  it('refuses a sold-out product', () => {
    expect(posStockCheck(product({ is_available: false }), 0, 1)).toEqual({
      ok: false,
      message: 'هذا الصنف غير متوفر',
    });
    expect(posStockCheck(product({ stock: 0 }), 0, 1)).toEqual({
      ok: false,
      message: 'هذا الصنف غير متوفر',
    });
  });

  it('refuses a quantity beyond what remains', () => {
    expect(posStockCheck(product({ stock: 3 }), 2, 2)).toEqual({
      ok: false,
      message: 'الكمية المطلوبة أكثر من المتوفر',
    });
    expect(posStockCheck(product({ stock: 3 }), 2, 1).ok).toBe(true);
  });

  it('allows anything for an untracked product', () => {
    expect(posStockCheck(product({ stock: null }), 99, 99).ok).toBe(true);
  });
});

describe('buildPosLine', () => {
  it('prices the varieties into the unit price, at the currency decimals', () => {
    const withOptions = product({ option_groups: [group()] });
    expect(buildPosLine(withOptions, ['c1'], ['صغير'], 2, 'BHD').unitPrice).toBe(2);
    // ≤3 decimals is the BHD rule; the same choice rounds differently in SAR.
    const bhd = product({ price: 1, option_groups: [group({ option_choices: [choice('c1', 0.12345)] })] });
    expect(buildPosLine(bhd, ['c1'], [], 1, 'BHD').unitPrice).toBe(1.123);
    expect(buildPosLine(bhd, ['c1'], [], 1, 'SAR').unitPrice).toBe(1.12);
  });

  it('prices a product with no selection at its own price', () => {
    expect(buildPosLine(product(), [], [], 1, 'BHD').unitPrice).toBe(1.5);
  });
});

describe('cart line arithmetic', () => {
  it('stacks onto the same configuration instead of adding a second line', () => {
    const lines = addPosLine([], posLine(), 1);
    const again = addPosLine(lines, posLine(), 2);
    expect(again).toHaveLength(1);
    expect(again[0].quantity).toBe(3);
  });

  it('keeps a different configuration as its own line', () => {
    const lines = addPosLine([], posLine(), 1);
    const withOptions = addPosLine(lines, posLine({ key: 'p1:c1', optionIds: ['c1'] }), 1);
    expect(withOptions).toHaveLength(2);
  });

  it('drops a line at zero and never below', () => {
    expect(changePosQty([posLine({ quantity: 1 })], 'p1:', -1)).toHaveLength(0);
    expect(changePosQty([posLine({ quantity: 1 })], 'p1:', -5)).toHaveLength(0);
  });

  it('sets a quantity outright (the cart panel field)', () => {
    expect(setPosQty([posLine()], 'p1:', 7)[0].quantity).toBe(7);
  });

  it('totals through the shared cart maths, not a second definition', () => {
    const lines = addPosLine(addPosLine([], posLine(), 2), posLine({ key: 'p2:', unitPrice: 0.5 }), 3);
    expect(cartTotal(lines, 'BHD')).toBe(4.5);
  });
});
