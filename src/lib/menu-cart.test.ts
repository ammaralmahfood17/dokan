import { describe, expect, it } from 'vitest';
import {
  addLine,
  buildPickedLine,
  buildQuickLine,
  cartItemCount,
  cartTotal,
  categoriesWithProducts,
  changeQuantity,
  filterMenuProducts,
  groupByCategory,
  lastProductLineKey,
  lineKey,
  needsPicker,
  productQtyInCart,
  qtyByProduct,
  toggleOptionSelection,
  toggleQuickNoteText,
  uncategorizedProducts,
} from './menu-cart';
import { availableChoices } from './product-options';
import type {
  CartLine,
  Category,
  Product,
  ProductOptionChoice,
  ProductOptionGroup,
  ProductWithOptions,
} from './types';

/**
 * The public menu's cart rules used to live inline in a 1038-line client
 * component with no unit coverage. These are the customer-visible rules: two
 * adds of the same item must merge into one line, a single-choice group must
 * replace, a quick-note must lose the separator it leaves behind, and quick-add
 * must not bypass a group that needs a choice.
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
    option_choices: [choice('c1'), choice('c2')],
    ...over,
  };
}

function product(over: Partial<ProductWithOptions> = {}): ProductWithOptions {
  const base = {
    id: 'p1',
    project_id: 'pr1',
    category_id: null,
    name: 'قهوة',
    name_en: 'Coffee',
    description: null,
    price: 1.5,
    image_url: null,
    is_available: true,
    sort_order: 0,
    created_at: '2026-10-13T00:00:00Z',
    stock: null,
  } as unknown as Product;
  return { ...base, option_groups: [], ...over };
}

function line(over: Partial<CartLine> = {}): CartLine {
  return {
    key: 'p1::',
    productId: 'p1',
    productName: 'قهوة',
    unitPrice: 1.5,
    quantity: 1,
    addons: [],
    notes: '',
    ...over,
  };
}

describe('lineKey', () => {
  it('gives a product with nothing selected the same key the quick-add path uses', () => {
    expect(lineKey('p1', [], '')).toBe('p1::');
    expect(buildQuickLine(product(), 'BHD').key).toBe('p1::');
  });

  it('ignores the order the varieties were tapped in', () => {
    expect(lineKey('p1', ['b', 'a'], '')).toBe(lineKey('p1', ['a', 'b'], ''));
  });

  it('keeps the note in the key, so «بدون سكر» is its own line', () => {
    expect(lineKey('p1', [], 'بدون سكر')).not.toBe(lineKey('p1', [], ''));
  });
});

describe('cart maths', () => {
  it('totals lines and rounds to the currency decimals', () => {
    expect(cartTotal([line({ unitPrice: 1.234, quantity: 3 })], 'BHD')).toBe(3.702);
    expect(cartTotal([line({ unitPrice: 0.12345, quantity: 2 })], 'SAR')).toBe(0.25);
  });

  it('counts units, not lines', () => {
    expect(cartItemCount([line({ quantity: 2 }), line({ key: 'p2::', productId: 'p2', quantity: 3 })])).toBe(5);
  });

  it('buckets units per product for the grid', () => {
    const map = qtyByProduct([line({ quantity: 2 }), line({ key: 'k2', quantity: 1 }), line({ key: 'k3', productId: 'p2', quantity: 4 })]);
    expect(map.get('p1')).toBe(3);
    expect(map.get('p2')).toBe(4);
  });

  it('counts one product in the cart for the stock cap', () => {
    expect(productQtyInCart([line({ quantity: 2 }), line({ key: 'k2', productId: 'p2', quantity: 5 })], 'p1')).toBe(2);
  });
});

describe('addLine / changeQuantity', () => {
  it('increments an existing line instead of adding a second one', () => {
    const first = addLine([], line());
    expect(first.incremented).toBe(false);
    const second = addLine(first.lines, line());
    expect(second.incremented).toBe(true);
    expect(second.lines).toHaveLength(1);
    expect(second.lines[0].quantity).toBe(2);
  });

  it('drops a line when its quantity reaches zero', () => {
    const lines = [line({ quantity: 1 }), line({ key: 'p2::', productId: 'p2' })];
    expect(changeQuantity(lines, 'p1::', -1).map((l) => l.key)).toEqual(['p2::']);
  });

  it('targets the most recently added line for a product (the stepper)', () => {
    const lines = [line({ key: 'a' }), line({ key: 'b' })];
    expect(lastProductLineKey(lines, 'p1')).toBe('b');
    expect(lastProductLineKey(lines, 'nope')).toBeUndefined();
  });
});

describe('browsing', () => {
  const products = [
    product({ id: 'p1', name: 'قهوة عربية', name_en: 'Arabic Coffee', category_id: 'c1' }),
    product({ id: 'p2', name: 'شاي', name_en: null, category_id: 'c1' }),
    product({ id: 'p3', name: 'كيك', name_en: 'Cake', category_id: 'c2' }),
    product({ id: 'p4', name: 'ماء', name_en: null }), // category deleted → NULL
  ];
  const categories = [
    { id: 'c1', name: 'مشروبات' },
    { id: 'c2', name: 'حلويات' },
    { id: 'c3', name: 'غير مستخدم' },
  ] as unknown as Category[];

  it('filters by category', () => {
    expect(filterMenuProducts(products, 'c1', '').map((p) => p.id)).toEqual(['p1', 'p2']);
    expect(filterMenuProducts(products, 'all', '')).toHaveLength(4);
  });

  it('searches both languages', () => {
    expect(filterMenuProducts(products, 'all', 'coffee').map((p) => p.id)).toEqual(['p1']);
    expect(filterMenuProducts(products, 'all', 'قهوة').map((p) => p.id)).toEqual(['p1']);
  });

  it('keeps uncategorized products visible', () => {
    expect(uncategorizedProducts(filterMenuProducts(products, 'all', '')).map((p) => p.id)).toEqual(['p4']);
  });

  it('groups by category and hides categories with nothing in view', () => {
    const search = filterMenuProducts(products, 'all', 'كيك');
    const byCategory = groupByCategory(search);
    expect(categoriesWithProducts(categories, byCategory).map((c) => c.id)).toEqual(['c2']);
    expect(byCategory.get('c2')).toHaveLength(1);
  });
});

describe('option selection', () => {
  it('replaces the choice in a single-choice group', () => {
    expect(toggleOptionSelection(['c1'], group(), 'c2')).toEqual(['c2']);
  });

  it('toggles off a tapped choice', () => {
    expect(toggleOptionSelection(['c1'], group(), 'c1')).toEqual([]);
  });

  it('appends in a multi group up to its bound, then ignores the tap', () => {
    const multi = group({ min_select: 0, max_select: 2, option_choices: [choice('c1'), choice('c2'), choice('c3')] });
    const two = toggleOptionSelection(toggleOptionSelection([], multi, 'c1'), multi, 'c2');
    expect(two).toEqual(['c1', 'c2']);
    expect(toggleOptionSelection(two, multi, 'c3')).toEqual(['c1', 'c2']);
  });

  it('counts only the AVAILABLE picks toward a multi group bound', () => {
    // Sold-out varieties are hidden/disabled by the picker and rejected by
    // create_order_transactional (OPTION_UNAVAILABLE); the selection rule's job
    // is the bound, and it must not let a choice the group no longer offers
    // consume it.
    const multi = group({
      min_select: 0,
      max_select: 2,
      option_choices: [choice('c1'), choice('c2'), choice('c3', 0, false)],
    });
    expect(availableChoices(multi).map((c) => c.id)).toEqual(['c1', 'c2']);
    const two = toggleOptionSelection(toggleOptionSelection([], multi, 'c1'), multi, 'c2');
    expect(two).toEqual(['c1', 'c2']);
    expect(toggleOptionSelection(two, multi, 'c1')).toEqual(['c2']);
  });
});

describe('quick notes', () => {
  it('appends with the Arabic comma', () => {
    expect(toggleQuickNoteText('', 'بدون سكر')).toBe('بدون سكر');
    expect(toggleQuickNoteText('بدون سكر', 'بدون ثلج')).toBe('بدون سكر، بدون ثلج');
  });

  it('removes a phrase and tidies the separator it leaves behind', () => {
    expect(toggleQuickNoteText('بدون سكر، بدون ثلج', 'بدون سكر')).toBe('بدون ثلج');
    expect(toggleQuickNoteText('بدون ثلج، بدون سكر', 'بدون سكر')).toBe('بدون ثلج');
  });

  it('refuses to grow past 200 characters', () => {
    const long = 'ا'.repeat(200);
    expect(toggleQuickNoteText(long, 'حار زيادة')).toBe(long);
  });
});

describe('buildPickedLine', () => {
  it('prices the varieties into the unit price', () => {
    const result = buildPickedLine(
      product({ price: 1 }),
      [group({ option_choices: [choice('c1', 0.25)] })],
      ['c1'],
      '',
      'BHD'
    );
    expect(result.ok).toBe(true);
    if (result.ok) {
      expect(result.line.unitPrice).toBe(1.25);
      expect(result.line.addons).toEqual([{ id: 'c1', name: 'c-c1', price: 0.25 }]);
      expect(result.line.key).toBe('p1:c1:');
    }
  });

  it('refuses a selection the group rules reject', () => {
    const required = group({ min_select: 1, option_choices: [choice('c1')] });
    const result = buildPickedLine(product(), [required], [], '', 'BHD');
    expect(result.ok).toBe(false);
    if (!result.ok) expect(result.message).toBeTruthy();
  });
});

describe('needsPicker', () => {
  it('is false for a product with no options', () => {
    expect(needsPicker(product())).toBe(false);
  });
  it('is true as soon as a group has an available variety', () => {
    expect(needsPicker(product({ option_groups: [group()] }))).toBe(true);
  });
  it('is false when every variety of the group is sold out', () => {
    expect(needsPicker(product({ option_groups: [group({ option_choices: [choice('c1', 0, false)] })] }))).toBe(false);
  });
});
