import { describe, expect, it } from 'vitest';
import {
  bahrainDayStart,
  dayRange,
  filterOrders,
  shiftDateKey,
  sortOrders,
  toDateKey,
  type FilterableOrder,
} from './order-filters';
import type { OrderStatus } from './types';

/**
 * The orders page's rules used to live inside a 608-line client component with
 * no coverage. They are pure here, so the two bugs this page has already
 * shipped can never come back unnoticed: a "today" computed from the DEVICE
 * clock, and a date offset applied to the device date instead of the Bahrain
 * day key.
 */

function order(over: Partial<FilterableOrder> = {}): FilterableOrder {
  return {
    status: 'pending' as OrderStatus,
    order_number: 1,
    created_at: '2026-10-13T09:00:00.000Z',
    total_amount: 1,
    tables: null,
    order_items: [],
    ...over,
  };
}

describe('Bahrain day keys', () => {
  it('keys an instant by the Bahrain day, not the device day', () => {
    // 21:30 UTC on the 12th is 00:30 on the 13th in Bahrain — the exact window
    // a late-night café trades in, and the one a device-zone key drops.
    expect(toDateKey(new Date('2026-10-12T21:30:00Z'))).toBe('2026-10-13');
    expect(toDateKey(new Date('2026-10-12T20:59:00Z'))).toBe('2026-10-12');
  });

  it('shifts the day KEY, so an offset cannot be re-applied in device time', () => {
    expect(shiftDateKey('2026-10-13', -1)).toBe('2026-10-12');
    expect(shiftDateKey('2026-10-01', -1)).toBe('2026-09-30');
    expect(shiftDateKey('2026-03-01', -1)).toBe('2026-02-28');
  });

  it('gives a half-open window that starts at Bahrain midnight', () => {
    const { start, end } = dayRange('2026-10-13');
    expect(start.toISOString()).toBe('2026-10-12T21:00:00.000Z');
    expect(end.toISOString()).toBe('2026-10-13T21:00:00.000Z');
  });

  it('derives the server day start from the same key', () => {
    expect(bahrainDayStart(new Date('2026-10-12T21:30:00Z')).toISOString()).toBe(
      '2026-10-12T21:00:00.000Z'
    );
  });
});

describe('filterOrders', () => {
  const rows = [
    order({ order_number: 12, status: 'pending', tables: { number: 3 } }),
    order({ order_number: 27, status: 'preparing', order_items: [{ product_name: 'قهوة عربية' }] }),
    order({ order_number: 31, status: 'delivered', order_items: [{ product_name: 'Karak Tea' }] }),
  ];

  it('returns everything for the «الكل» chip', () => {
    expect(filterOrders(rows, { filter: 'all', query: '' })).toHaveLength(3);
  });

  it('filters by status', () => {
    expect(filterOrders(rows, { filter: 'preparing', query: '' }).map((o) => o.order_number)).toEqual([27]);
  });

  it('matches a partial order number', () => {
    expect(filterOrders(rows, { filter: 'all', query: '2' }).map((o) => o.order_number)).toEqual([12, 27]);
  });

  it('matches a table number', () => {
    expect(filterOrders(rows, { filter: 'all', query: '3' }).map((o) => o.order_number)).toEqual([12, 31]);
  });

  it('matches a product name case-insensitively', () => {
    expect(filterOrders(rows, { filter: 'all', query: 'karak' }).map((o) => o.order_number)).toEqual([31]);
    expect(filterOrders(rows, { filter: 'all', query: 'قهوة' }).map((o) => o.order_number)).toEqual([27]);
  });

  it('applies the status chip and the search together', () => {
    expect(filterOrders(rows, { filter: 'delivered', query: 'karak' })).toHaveLength(1);
    expect(filterOrders(rows, { filter: 'pending', query: 'karak' })).toHaveLength(0);
  });

  it('treats a whitespace-only query as no query', () => {
    expect(filterOrders(rows, { filter: 'all', query: '   ' })).toHaveLength(3);
  });
});

describe('sortOrders', () => {
  const rows = [
    order({ order_number: 1, created_at: '2026-10-13T09:00:00.000Z', total_amount: 5 }),
    order({ order_number: 2, created_at: '2026-10-13T11:00:00.000Z', total_amount: 1 }),
    order({ order_number: 3, created_at: '2026-10-13T10:00:00.000Z', total_amount: 9 }),
  ];

  it('leaves the query order alone for «الأحدث»', () => {
    expect(sortOrders(rows, 'newest').map((o) => o.order_number)).toEqual([1, 2, 3]);
  });

  it('sorts oldest first', () => {
    expect(sortOrders(rows, 'oldest').map((o) => o.order_number)).toEqual([1, 3, 2]);
  });

  it('sorts by amount, highest first, and compares numbers not strings', () => {
    expect(sortOrders(rows, 'amount').map((o) => o.order_number)).toEqual([3, 1, 2]);
  });

  it('never mutates the rows it was given', () => {
    const before = rows.map((o) => o.order_number);
    sortOrders(rows, 'amount');
    expect(rows.map((o) => o.order_number)).toEqual(before);
  });
});
