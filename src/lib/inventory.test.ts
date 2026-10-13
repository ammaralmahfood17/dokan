import { describe, expect, it } from 'vitest';
import {
  INGREDIENT_UNITS,
  MOVEMENT_LABELS,
  UNIT_LABELS,
  isLowStock,
  lowStockCount,
  prevRecipeUses,
  quantity,
  validateIngredientInput,
  validateMovementInput,
  validateRecipeLines,
  validateSupplierInput,
} from './inventory';

/**
 * The inventory rules protect real stock numbers. Before this module they lived
 * inline in a 676-line client component and nothing checked them; the two that
 * matter most are that a receipt must be positive and that a recipe may not
 * list an ingredient twice (the second line would deduct it twice for one
 * order, silently).
 */

describe('labels and formatting', () => {
  it('labels every unit and every movement type (a new enum value fails here)', () => {
    expect(Object.keys(UNIT_LABELS).sort()).toEqual(['each', 'g', 'ml']);
    expect(Object.keys(MOVEMENT_LABELS).sort()).toEqual([
      'adjustment',
      'consume',
      'receive',
      'restore',
    ]);
    expect(INGREDIENT_UNITS).not.toContain('kg');
  });

  it('renders quantities with up to 3 decimals and Latin digits', () => {
    expect(quantity(1)).toBe('1');
    expect(quantity('2.5')).toBe('2.5');
    expect(quantity(0.1234)).toBe('0.123');
  });
});

describe('low stock', () => {
  it('flags at or below the reorder point, not only below', () => {
    expect(isLowStock({ quantity_on_hand: 5, reorder_point: 5 })).toBe(true);
    expect(isLowStock({ quantity_on_hand: 6, reorder_point: 5 })).toBe(false);
    expect(isLowStock({ quantity_on_hand: '0', reorder_point: '150' })).toBe(true);
  });

  it('counts the rows that need attention', () => {
    expect(
      lowStockCount([
        { quantity_on_hand: 1, reorder_point: 2 },
        { quantity_on_hand: 9, reorder_point: 2 },
        { quantity_on_hand: 0, reorder_point: 0 },
      ])
    ).toBe(2);
  });
});

describe('prevRecipeUses', () => {
  const lines = [
    { ingredient_id: 'a', quantity: '1' },
    { ingredient_id: 'b', quantity: '1' },
  ];
  it('sees an ingredient used by another line', () => {
    expect(prevRecipeUses(lines, 1, 'a')).toBe(true);
  });
  it('does not count the line itself', () => {
    expect(prevRecipeUses(lines, 0, 'a')).toBe(false);
  });
});

describe('validateIngredientInput', () => {
  it('accepts a named ingredient with a non-negative reorder point', () => {
    const result = validateIngredientInput({ name: 'طحين', reorderPoint: 150, unit: 'g', editing: false });
    expect(result).toEqual({ ok: true, value: { name: 'طحين', reorder_point: 150, unit: 'g' } });
  });

  it('refuses a blank name or a negative reorder point', () => {
    expect(validateIngredientInput({ name: '  ', reorderPoint: 1, unit: 'g', editing: false }).ok).toBe(false);
    expect(validateIngredientInput({ name: 'طحين', reorderPoint: -1, unit: 'g', editing: false }).ok).toBe(false);
  });

  it('refuses an unknown unit on create, but not on edit (the unit is kept)', () => {
    expect(validateIngredientInput({ name: 'طحين', reorderPoint: 0, unit: 'kg', editing: false }).ok).toBe(false);
    const edit = validateIngredientInput({ name: 'طحين', reorderPoint: 0, unit: 'kg', editing: true });
    expect(edit.ok).toBe(true);
    // `unit: null` on an edit = keep the unit the row already has.
    if (edit.ok) expect(edit.value).toEqual({ name: 'طحين', reorder_point: 0, unit: null });
  });

  it('trims the name', () => {
    const result = validateIngredientInput({ name: '  طحين  ', reorderPoint: 0, unit: 'g', editing: false });
    if (result.ok) expect(result.value.name).toBe('طحين');
  });
});

describe('validateSupplierInput', () => {
  it('needs a name only', () => {
    expect(validateSupplierInput({ name: 'مؤسسة الأغذية' }).ok).toBe(true);
    expect(validateSupplierInput({ name: '   ' })).toEqual({
      ok: false,
      message: 'أدخل اسم المورّد',
    });
  });
});

describe('validateMovementInput', () => {
  it('accepts a positive receipt and a signed adjustment', () => {
    expect(validateMovementInput({ movementType: 'receive', amount: 5 }).ok).toBe(true);
    expect(validateMovementInput({ movementType: 'adjustment', amount: -5 }).ok).toBe(true);
  });

  it('refuses a negative receipt and a zero amount', () => {
    expect(validateMovementInput({ movementType: 'receive', amount: -5 })).toEqual({
      ok: false,
      message: 'أدخل كمية صحيحة؛ الاستلام يجب أن يكون موجبًا',
    });
    expect(validateMovementInput({ movementType: 'receive', amount: 0 }).ok).toBe(false);
    expect(validateMovementInput({ movementType: 'adjustment', amount: 0 }).ok).toBe(false);
    expect(validateMovementInput({ movementType: 'adjustment', amount: NaN }).ok).toBe(false);
  });
});

describe('validateRecipeLines', () => {
  it('accepts complete, unique lines and parses the quantities', () => {
    const result = validateRecipeLines([
      { ingredient_id: 'a', quantity: '2.5' },
      { ingredient_id: 'b', quantity: '1' },
    ]);
    expect(result).toEqual({
      ok: true,
      value: [
        { ingredient_id: 'a', quantity: 2.5 },
        { ingredient_id: 'b', quantity: 1 },
      ],
    });
  });

  it('accepts an empty recipe (it means "stop tracking this product")', () => {
    expect(validateRecipeLines([])).toEqual({ ok: true, value: [] });
  });

  it('refuses an incomplete line, a zero quantity, or a repeated ingredient', () => {
    const message = 'أكمل كل المكوّنات والكميات، ولا تكرر المكوّن';
    expect(validateRecipeLines([{ ingredient_id: '', quantity: '1' }])).toEqual({ ok: false, message });
    expect(validateRecipeLines([{ ingredient_id: 'a', quantity: '0' }])).toEqual({ ok: false, message });
    expect(validateRecipeLines([{ ingredient_id: 'a', quantity: 'abc' }])).toEqual({ ok: false, message });
    expect(
      validateRecipeLines([
        { ingredient_id: 'a', quantity: '1' },
        { ingredient_id: 'a', quantity: '2' },
      ])
    ).toEqual({ ok: false, message });
  });
});
