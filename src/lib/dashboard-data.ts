// ============================================================================
// D1: Dashboard data helpers — extracted from the old god-component
// (src/app/dashboard/page.tsx, ~590 lines). Pure functions + types shared by
// the dashboard orchestrator and its section components. No React state.
// ============================================================================

import { ORDER_TYPE_LABELS, type OrderType } from '@/lib/types';

export type HourBucket = { key: string; label: string; revenue: number };
export type DayBucket = { key: string; label: string; revenue: number };

/** Last-7-days buckets (Asia/Bahrain) — built outside the component so the
 * react-hooks purity rule doesn't flag Date.now() during render. */
export function buildWeekBuckets(
  dayFmt: Intl.DateTimeFormat
): { weekAgo: Date; byDay7: DayBucket[] } {
  const now = Date.now();
  const dayKeys: string[] = [];
  for (let i = 6; i >= 0; i--) {
    dayKeys.push(dayFmt.format(new Date(now - i * 86_400_000)));
  }
  const weekdayFmt = new Intl.DateTimeFormat('ar-BH', {
    numberingSystem: 'latn',
    weekday: 'short',
    timeZone: 'Asia/Bahrain',
  });
  return {
    weekAgo: new Date(now - 7 * 86_400_000),
    byDay7: dayKeys.map((key) => ({
      key,
      // Format the UTC instant with an explicit timeZone — without it a UTC
      // server would show the previous day's weekday (off-by-one).
      label: weekdayFmt.format(new Date(`${key}T00:00:00+03:00`)),
      revenue: 0,
    })),
  };
}

/** Last-7-hours buckets (Asia/Bahrain) — mirrors the mockup's hourly chart. */
export function buildHourBuckets(): HourBucket[] {
  const now = new Date();
  const hourFmt = new Intl.DateTimeFormat('en-CA', {
    timeZone: 'Asia/Bahrain',
    year: 'numeric',
    month: '2-digit',
    day: '2-digit',
    hour: '2-digit',
    hourCycle: 'h23',
  });
  // Arabic hour label from the same instant — explicit timeZone, NO manual
  // +3h shift (that double-converts on UTC+3 hosts and is wrong everywhere
  // except pure-UTC servers).
  const labelFmt = new Intl.DateTimeFormat('ar-BH', {
    // AR-9: أرقام لاتينية إجبارية على ساعات المخطط
    numberingSystem: 'latn',
    hour: 'numeric',
    timeZone: 'Asia/Bahrain',
  });
  const buckets: HourBucket[] = [];
  for (let i = 6; i >= 0; i--) {
    const d = new Date(now.getTime() - i * 3_600_000);
    const parts = hourFmt.formatToParts(d);
    const get = (t: string) => parts.find((p) => p.type === t)?.value ?? '';
    const hour = get('hour');
    const key = `${get('year')}-${get('month')}-${get('day')}T${hour.padStart(2, '0')}`;
    buckets.push({ key, label: labelFmt.format(d), revenue: 0 });
  }
  return buckets;
}

/** Same formatter as buildHourBuckets — hourCycle:'h23' guarantees keys
 * match (hour12:false can yield "24" on some ICU engines). */
export function buildHourKeyFmt(): Intl.DateTimeFormat {
  return new Intl.DateTimeFormat('en-CA', {
    timeZone: 'Asia/Bahrain',
    year: 'numeric',
    month: '2-digit',
    day: '2-digit',
    hour: '2-digit',
    hourCycle: 'h23',
  });
}

export type WeekTopStat = { qty: number; revenue: number };

export type RecentOrder = {
  id: string;
  status: string;
  total_amount: number;
  type: string;
  order_number: number;
  created_at: string;
  tables?: { number: number } | null;
};

export type WeekOrder = {
  status: string;
  total_amount: number;
  created_at: string;
  order_items?: {
    product_name: string;
    quantity: number;
    unit_price: number;
  }[] | null;
};

/** Table label for the recent-orders table: `01`, `سفري 07`, or `سيارة 12`.
 *  (2026-10-02: the Latin `Drive-NN`/`Walk-NN` fallbacks were the last hardcoded
 *  English strings in the Arabic dashboard.) */
export function tableLabel(o: RecentOrder): string {
  if (o.tables) return String(o.tables.number).padStart(2, '0');
  const label = ORDER_TYPE_LABELS[o.type as OrderType] ?? o.type;
  return `${label} ${String(o.order_number).padStart(2, '0')}`;
}
