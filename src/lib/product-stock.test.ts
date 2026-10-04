import { describe, expect, it } from 'vitest';
import {
  LOW_STOCK_THRESHOLD,
  isSoldOut,
  lowStockLabel,
  maxOrderableQty,
  remainingStock,
} from './product-stock';

describe('remainingStock', () => {
  it('treats NULL (and a missing column) as untracked', () => {
    expect(remainingStock({ is_available: true, stock: null })).toBeNull();
    expect(remainingStock({ is_available: true })).toBeNull();
  });

  it('returns the count, never below zero', () => {
    expect(remainingStock({ is_available: true, stock: 7 })).toBe(7);
    expect(remainingStock({ is_available: true, stock: 0 })).toBe(0);
    expect(remainingStock({ is_available: true, stock: -3 })).toBe(0);
  });
});

describe('isSoldOut', () => {
  it('is sold out when the merchant switched it off', () => {
    expect(isSoldOut({ is_available: false, stock: 10 })).toBe(true);
    expect(isSoldOut({ is_available: false, stock: null })).toBe(true);
  });

  it('is sold out when a tracked product has no portions left', () => {
    expect(isSoldOut({ is_available: true, stock: 0 })).toBe(true);
  });

  it('is orderable when tracked with portions left, or untracked', () => {
    expect(isSoldOut({ is_available: true, stock: 1 })).toBe(false);
    expect(isSoldOut({ is_available: true, stock: null })).toBe(false);
  });
});

describe('maxOrderableQty', () => {
  it('is infinite for an untracked product', () => {
    expect(maxOrderableQty({ is_available: true, stock: null })).toBe(
      Number.POSITIVE_INFINITY
    );
  });

  it('is the remaining count for a tracked one', () => {
    expect(maxOrderableQty({ is_available: true, stock: 3 })).toBe(3);
    expect(maxOrderableQty({ is_available: true, stock: 0 })).toBe(0);
  });
});

describe('lowStockLabel', () => {
  it('stays quiet for untracked, sold out, or comfortably stocked products', () => {
    expect(lowStockLabel({ is_available: true, stock: null })).toBeNull();
    expect(lowStockLabel({ is_available: true, stock: 0 })).toBeNull();
    expect(lowStockLabel({ is_available: true, stock: LOW_STOCK_THRESHOLD + 1 })).toBeNull();
  });

  it('surfaces a low count', () => {
    expect(lowStockLabel({ is_available: true, stock: LOW_STOCK_THRESHOLD })).toBe(
      LOW_STOCK_THRESHOLD
    );
    expect(lowStockLabel({ is_available: true, stock: 1 })).toBe(1);
  });
});
