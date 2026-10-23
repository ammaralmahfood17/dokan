/**
 * Floor-plan display rules, pure and tested.
 *
 * The floor plan is the only place a merchant can see, at a glance, WHICH tables
 * are busy. Since 2026-10-23 "busy" is an explicit `table_sessions` row, not a
 * guess from order statuses: the kitchen delivering the last order no longer
 * frees the table — only a staff member closes it. This module holds the parts
 * that can be wrong: the duration label, the three states, and the rule that
 * decides which one wins.
 */

import type { TableBoardRow } from './types';

const MINUTE = 60_000;

/** Whole minutes since an ISO timestamp. Negative (clock skew) clamps to 0, never "-3". */
export function minutesSince(iso: string, nowMs: number): number {
  const started = Date.parse(iso);
  if (Number.isNaN(started)) return 0;
  return Math.max(0, Math.floor((nowMs - started) / MINUTE));
}

/**
 * Compact Arabic duration for a chip the size of a table: «12 د» under an hour,
 * «2 س 5 د» above it — and «1 د» for the first minute, because a table that just
 * got an order is worth showing as busy rather than as «0 د».
 */
export function occupiedLabel(minutes: number): string {
  const m = Math.max(1, Math.floor(minutes));
  if (m < 60) return `${m} د`;
  const h = Math.floor(m / 60);
  const rest = m % 60;
  return rest === 0 ? `${h} س` : `${h} س ${rest} د`;
}

export type TableOccupancy = 'free' | 'busy' | 'awaiting_bill' | 'inactive';

/**
 * One table, one state. A live session wins over `is_active` — a table the
 * merchant deactivated mid-service still has customers and must stay closable.
 */
export function tableState(
  row: Pick<TableBoardRow, 'session_id' | 'bill_requested_at' | 'is_active'>
): TableOccupancy {
  if (row.session_id) {
    return row.bill_requested_at ? 'awaiting_bill' : 'busy';
  }
  return row.is_active ? 'free' : 'inactive';
}

export const OCCUPANCY_LABEL: Record<TableOccupancy, string> = {
  free: 'متاحة',
  busy: 'مشغولة',
  awaiting_bill: 'بانتظار الفاتورة',
  inactive: 'موقوفة',
};

/**
 * What the chip's second line says. Busy tables answer «how long», and when a
 * session has money on it the running total is the question a cashier actually
 * has; free tables answer «how many seats».
 */
export function chipSubline(
  row: Pick<TableBoardRow, 'session_id' | 'opened_at' | 'total_amount' | 'seats'>,
  state: TableOccupancy,
  nowMs: number | null
): string | null {
  if (state === 'busy' || state === 'awaiting_bill') {
    if (row.total_amount > 0) return formatAmount(row.total_amount);
    if (nowMs !== null && row.opened_at) return occupiedLabel(minutesSince(row.opened_at, nowMs));
    return null;
  }
  return row.seats != null ? String(row.seats) : null;
}

/** Three decimals, no currency symbol — the chip is too small for «د.ب». */
export function formatAmount(value: number): string {
  return value.toFixed(3);
}
