import type { OrderStatus } from './types';

/**
 * The orders page's rules, as pure functions.
 *
 * WHY THIS EXISTS (architecture review 2026-10-13, wave 4): `orders-client.tsx`
 * carried 608 lines — the Bahrain day arithmetic, the filter/sort/search rules,
 * paging, realtime and the whole list markup in one component, with no test
 * covering any of it. The rules below are the part that CAN be tested, so they
 * live here and the component only wires them up.
 *
 * Everything date-shaped is anchored to Bahrain (UTC+3), never to the device:
 * the server renders in UTC and the browser in whatever zone the merchant
 * travels in, so "today" written in device terms is two different days for the
 * same instant — the hydration mismatch (React #418) and the wrong-day bug that
 * shipped once already. Bahrain has no DST, so +03 is a constant.
 */
export const BAHRAIN_TZ = 'Asia/Bahrain';

/** Status chips. `all` is a chip too, so it is part of this list. */
export const FILTERS: { value: OrderStatus | 'all'; label: string }[] = [
  { value: 'all', label: 'الكل' },
  { value: 'pending', label: 'جديد' },
  { value: 'preparing', label: 'تحضير' },
  { value: 'ready', label: 'جاهز' },
  { value: 'delivered', label: 'مسلّم' },
  { value: 'cancelled', label: 'ملغى' },
];

/** The real process order (kitchen → counter) the read-only stepper shows. */
export const STATUS_STEPS: OrderStatus[] = ['pending', 'preparing', 'ready', 'delivered'];

/** Rows per manual "load more" page. */
export const PAGE_SIZE = 50;

export type SortKey = 'newest' | 'oldest' | 'amount';

const dateKeyFmt = new Intl.DateTimeFormat('en-CA', {
  timeZone: BAHRAIN_TZ,
  year: 'numeric',
  month: '2-digit',
  day: '2-digit',
});

/** YYYY-MM-DD in Bahrain — identical output on the server and in the browser. */
export function toDateKey(d: Date): string {
  return dateKeyFmt.format(d);
}

/** Offset a day KEY (not a device date, which would drift outside +03). */
export function shiftDateKey(key: string, offsetDays: number): string {
  const d = new Date(`${key}T00:00:00+03:00`);
  d.setUTCDate(d.getUTCDate() + offsetDays);
  return toDateKey(d);
}

/** [Bahrain midnight of the day, the next midnight) — the query's day window. */
export function dayRange(dateKey: string): { start: Date; end: Date } {
  // Bahrain midnight is 21:00 UTC of the previous day; pinning it explicitly
  // keeps the query window and the displayed day from disagreeing.
  const start = new Date(`${dateKey}T00:00:00+03:00`);
  const end = new Date(start.getTime() + 24 * 60 * 60 * 1000);
  return { start, end };
}

/** The server's "today" boundary — the same rule, for the SSR first page. */
export function bahrainDayStart(instant: Date = new Date()): Date {
  return new Date(Date.parse(`${toDateKey(instant)}T00:00:00+03:00`));
}

/** The slice of an order row these rules need. */
export type FilterableOrder = {
  status: OrderStatus;
  order_number: number;
  created_at: string;
  total_amount: number | string;
  tables?: { number: number; slug?: string } | null;
  order_items?: { product_name: string | null }[] | null;
};

/**
 * Status chip + instant search, in the order the merchant sees them.
 *
 * Search matches an order number, a table number, or a PRODUCT NAME on any
 * line. Product names are compared case-insensitively (they are free text);
 * the two numbers are compared as raw strings, because that is what typing a
 * partial order number into the box does.
 */
export function filterOrders<T extends FilterableOrder>(
  rows: T[],
  opts: { filter: OrderStatus | 'all'; query: string }
): T[] {
  let list = rows;
  if (opts.filter !== 'all') list = list.filter((o) => o.status === opts.filter);

  const q = opts.query.trim().toLowerCase();
  if (!q) return list;

  return list.filter((o) => {
    if (String(o.order_number).includes(q)) return true;
    if (o.tables && String(o.tables.number).includes(q)) return true;
    return (o.order_items ?? []).some((it) => (it.product_name ?? '').toLowerCase().includes(q));
  });
}

/**
 * Sort a copy of the rows. `newest` is the query's own order
 * (`created_at desc`), so it needs no comparison — changing it here would
 * disagree with the paged reads that already came back newest-first.
 */
export function sortOrders<T extends { created_at: string; total_amount: number | string }>(
  rows: T[],
  sortBy: SortKey
): T[] {
  const sorted = [...rows];
  if (sortBy === 'oldest') {
    sorted.sort((a, b) => a.created_at.localeCompare(b.created_at));
  } else if (sortBy === 'amount') {
    sorted.sort((a, b) => Number(b.total_amount) - Number(a.total_amount));
  }
  return sorted;
}
