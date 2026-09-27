import type { OrderStatus } from './types';

/**
 * FIX-PAGE-004 (2026-09-28): the orders header (مبيعات اليوم + the status
 * chips) used to be computed from the LOADED page, so on a busy day the total
 * under-reported and each chip counted only the rows fetched so far. The
 * header now comes from a full-day read, and this module is the single
 * counting rule shared by the SSR initial state and the client refresh — if
 * they ever drift, the header would disagree with itself after a refresh.
 *
 * Pure functions, no React: this is the domain logic, the component is the
 * view. Same split as lib/kitchen-tickets.ts.
 */
export type StatusCounts = Record<OrderStatus | 'all', number>;

/** Zeroed counts — every key pre-seeded so a missing status is 0, never undefined. */
export function emptyStatusCounts(): StatusCounts {
  return {
    all: 0,
    pending: 0,
    preparing: 0,
    ready: 0,
    delivered: 0,
    cancelled: 0,
  };
}

/** Count orders per status plus the total. */
export function countStatuses(rows: { status: OrderStatus }[]): StatusCounts {
  const counts = emptyStatusCounts();
  counts.all = rows.length;
  for (const o of rows) counts[o.status] += 1;
  return counts;
}

/**
 * مبيعات اليوم — sum of non-cancelled orders. Cancelled orders are excluded
 * because the header is a sales figure, and a cancelled order was never paid.
 */
export function sumDaySales(rows: { status: OrderStatus; total_amount: number | string }[]): number {
  let total = 0;
  for (const o of rows) {
    if (o.status !== 'cancelled') total += Number(o.total_amount);
  }
  return total;
}
