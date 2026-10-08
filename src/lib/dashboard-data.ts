// ============================================================================
// Dashboard presentation types + labels.
//
// Audit 2026-10-07: the bucket BUILDER functions that used to live here
// (buildWeekBuckets / buildHourBuckets / buildHourKeyFmt) are gone — they are
// superseded by lib/dashboard-rollup.ts, which produces the same buckets as
// part of one pass over the fetched rows. The TYPES are still the contract the
// chart components take, so they are re-exported from the rollup to keep a
// single definition instead of two drifting copies.
// ============================================================================

export type { HourBucket, DayBucket } from '@/lib/dashboard-rollup';

import type { ProductStat } from '@/lib/dashboard-rollup';

/** Top-products row: quantity sold and revenue earned. */
export type WeekTopStat = ProductStat;

export type RecentOrder = {
  id: string;
  status: string;
  total_amount: number;
  type: string;
  order_number: number;
  created_at: string;
  tables?: { number: number } | null;
};

import { ORDER_TYPE_LABELS, type OrderType } from '@/lib/types';

/** Table label for the recent-orders table: `01`, `سفري 07`, or `سيارة 12`.
 *  (2026-10-02: the Latin `Drive-NN`/`Walk-NN` fallbacks were the last hardcoded
 *  English strings in the Arabic dashboard.) */
export function tableLabel(o: RecentOrder): string {
  if (o.tables) return String(o.tables.number).padStart(2, '0');
  const label = ORDER_TYPE_LABELS[o.type as OrderType] ?? o.type;
  return `${label} ${String(o.order_number).padStart(2, '0')}`;
}