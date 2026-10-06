import { describe, expect, it } from 'vitest';
import {
  availableChoices,
  effectiveBounds,
  isRequired,
  selectedChoices,
  validateOptionSelection,
} from './product-options';
import type { ProductOptionGroup } from './types';

/**
 * The option rules are the contract between the customer menu, the POS and
 * `create_order_transactional`. The RPC cases below were verified against
 * production with a throwaway store (see the migration header); these are the
 * same rules as pure functions, so a drift fails here instead of in the field.
 */

function choice(id: string, price: number, is_available = true, sort_order = 0) {
  return { id, group_id: 'g', name: `c-${id}`, name_en: null, price, is_available, sort_order };
}

function group(
  id: string,
  min_select: number,
  max_select: number,
  choices: ReturnType<typeof choice>[]
): ProductOptionGroup {
  return {
    id,
    product_id: 'p',
    name: `g-${id}`,
    name_en: null,
    min_select,
    max_select,
    sort_order: 0,
    option_choices: choices,
  };
}

const SIZE = group('size', 1, 1, [choice('s', 0), choice('m', 0.2), choice('l', 0.5)]);
const EXTRAS = group('extras', 0, 2, [choice('cheese', 0.1), choice('egg', 0.15)]);
const SOLD_OUT_SIZE = group('size', 1, 1, [choice('s', 0, false)]);

describe('availableChoices', () => {
  it('keeps only available varieties, in sort order', () => {
    const g = group('g', 0, 3, [
      choice('b', 0, true, 2),
      choice('a', 0, true, 1),
      choice('x', 0, false, 0),
    ]);
    expect(availableChoices(g).map((c) => c.id)).toEqual(['a', 'b']);
  });
});

describe('effectiveBounds', () => {
  it('passes the merchant bounds through when varieties are available', () => {
    expect(effectiveBounds(SIZE)).toEqual({ min: 1, max: 1 });
    expect(effectiveBounds(EXTRAS)).toEqual({ min: 0, max: 2 });
  });

  it('never requires a group whose varieties are all sold out', () => {
    expect(effectiveBounds(SOLD_OUT_SIZE)).toEqual({ min: 0, max: 0 });
    expect(isRequired(SOLD_OUT_SIZE)).toBe(false);
  });

  it('clamps a wide "multiple" max to the varieties that exist', () => {
    // The form writes 99 for a multi group; the clamp is what stops the server
    // from demanding more varieties than the group has.
    expect(effectiveBounds(group('g', 0, 99, [choice('a', 0), choice('b', 0)]))).toEqual({
      min: 0,
      max: 2,
    });
  });

  it('clamps a min larger than the available count', () => {
    expect(effectiveBounds(group('g', 3, 5, [choice('a', 0), choice('b', 0)])).min).toBe(2);
  });
});

describe('validateOptionSelection', () => {
  const groups = [SIZE, EXTRAS];

  it('accepts a required single pick plus optional extras', () => {
    expect(validateOptionSelection(groups, ['m', 'cheese', 'egg'])).toBeNull();
  });

  it('accepts an optional group left empty', () => {
    expect(validateOptionSelection(groups, ['s'])).toBeNull();
  });

  it('rejects a skipped required group, naming it', () => {
    const err = validateOptionSelection(groups, ['cheese']);
    expect(err?.message).toContain('g-size');
  });

  it('rejects two picks in a single-choice group', () => {
    const err = validateOptionSelection(groups, ['s', 'm']);
    expect(err?.message).toContain('نوعاً واحداً');
  });

  it('rejects going over a multi group max', () => {
    const g = [group('g', 0, 2, [choice('a', 0), choice('b', 0), choice('c', 0)])];
    const err = validateOptionSelection(g, ['a', 'b', 'c']);
    expect(err?.message).toContain('أقصى عدد 2');
  });

  it('rejects an unknown id (foreign product, deleted, or sold out)', () => {
    expect(validateOptionSelection(groups, ['s', 'ghost'])?.message).toContain('خيار غير صالح');
  });

  it('rejects a variety that is no longer available', () => {
    expect(validateOptionSelection([SOLD_OUT_SIZE], ['s'])?.message).toContain('خيار غير صالح');
  });

  it('treats a product with no groups as valid', () => {
    expect(validateOptionSelection([], [])).toBeNull();
  });
});

describe('selectedChoices', () => {
  it('returns the picked varieties in the order the customer picked them', () => {
    expect(selectedChoices([SIZE, EXTRAS], ['egg', 'm', 'cheese']).map((c) => c.id)).toEqual([
      'egg',
      'm',
      'cheese',
    ]);
  });

  it('drops ids that resolve to nothing', () => {
    expect(selectedChoices([SIZE], ['m', 'ghost']).map((c) => c.id)).toEqual(['m']);
  });
});