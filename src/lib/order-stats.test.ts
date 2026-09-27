import { describe, it, expect } from 'vitest';
import { countStatuses, emptyStatusCounts, sumDaySales } from './order-stats';
import type { OrderStatus } from './types';

/**
 * FIX-PAGE-004 regression guard.
 *
 * The bug: مبيعات اليوم and the status chips were computed from the LOADED
 * rows only, so a merchant who had paged to 50 of 300 orders saw a total for
 * 50. That is invisible in code review — the arithmetic is correct, the
 * INPUT is wrong — which is exactly why it needs value-level tests.
 *
 * Every case below is an edge a happy-path test would miss.
 */
const row = (status: OrderStatus, total: number) => ({ status, total_amount: total });

describe('countStatuses()', () => {
  it('counts every status and the total together', () => {
    const counts = countStatuses([
      row('pending', 1),
      row('pending', 2),
      row('delivered', 3),
      row('cancelled', 4),
    ]);
    expect(counts).toEqual({
      all: 4,
      pending: 2,
      preparing: 0,
      ready: 0,
      delivered: 1,
      cancelled: 1,
    });
  });

  it('returns all zeros for an empty day, never undefined', () => {
    // 08:00 with no orders yet is a real merchant state; a chip rendering
    // "undefined" would be a visible defect on a fresh store.
    expect(countStatuses([])).toEqual({
      all: 0,
      pending: 0,
      preparing: 0,
      ready: 0,
      delivered: 0,
      cancelled: 0,
    });
  });

  it('keeps every key numeric no matter which statuses appear', () => {
    // The chips do counts[f.value] directly, so a missing key is undefined and
    // React renders an empty chip. The keys are pre-seeded, so the shape is
    // stable regardless of the day's data.
    const counts = countStatuses([row('ready', 1)]);
    for (const key of Object.keys(emptyStatusCounts())) {
      expect(typeof counts[key as keyof typeof counts]).toBe('number');
    }
  });

  it('does not alias the zeroed template between calls', () => {
    // A shared mutable object would let one day's counts bleed into the next
    // call — invisible until a merchant switches days.
    const a = emptyStatusCounts();
    const b = emptyStatusCounts();
    a.pending = 99;
    expect(b.pending).toBe(0);
    expect(emptyStatusCounts().pending).toBe(0);
  });
});

describe('sumDaySales()', () => {
  it('excludes cancelled orders — a cancelled order was never paid', () => {
    expect(
      sumDaySales([row('delivered', 1.5), row('cancelled', 100), row('pending', 0.5)])
    ).toBe(2);
  });

  it('is 0 for a day with only cancelled orders, not their sum', () => {
    expect(sumDaySales([row('cancelled', 3), row('cancelled', 4)])).toBe(0);
  });

  it('coerces string numerics (PostgREST numeric → JSON string)', () => {
    // total_amount is `numeric`; without a cast, "1.500" + 0 = "1.5000"
    // string concatenation. The column is selected as a string in real
    // responses, so this is the actual production shape.
    expect(sumDaySales([row('delivered', '1.500' as unknown as number)])).toBe(1.5);
    expect(sumDaySales([row('delivered', '0.100' as unknown as number), row('pending', '0.200' as unknown as number)])).toBeCloseTo(0.3, 10);
  });

  it('survives a null/undefined amount without producing NaN', () => {
    // NaN would render as "NaN BHD" in the header — the worst possible output.
    const total = sumDaySales([
      row('delivered', null as unknown as number),
      row('pending', 2),
    ]);
    expect(total).toBe(2);
    expect(Number.isNaN(total)).toBe(false);
  });
});
