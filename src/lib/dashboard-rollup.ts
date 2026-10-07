/**
 * Dashboard rollup — one aggregation that produces every number the home screen
 * shows (audit 2026-10-07).
 *
 * WHY THIS EXISTS (measured, not guessed):
 *   Every dashboard query costs ~150 ms regardless of shape — a primary-key
 *   `select id` measures 149.9 ms while the heaviest 7-day scan with embedded
 *   order_items measures 152.1 ms. Network RTT to the Supabase host is 27 ms.
 *   The ~150 ms is constant PostgREST overhead, so what matters is the number of
 *   SEQUENTIAL round-trips (barriers), not the number of queries.
 *
 *   The dashboard used 5 sequential barriers (~855 ms measured). It now uses 3
 *   (auth, project context, one parallel data block) because every figure below
 *   is derived from the same fetched rows instead of from its own query.
 *
 * SCOPE — what this function derives, and from which input:
 *
 *   windowOrders (last 7 days, newest first, with order_items)
 *     → todayOrders, yesterdayOrders, todaySales, yesterdaySales,
 *       hourBuckets, peakHour, byDay7, topProducts
 *   openOrders (ANY date, status in pending|preparing|ready)
 *     → pendingCount, occupiedTableIds
 *   recentOrders (ANY date, newest 5)
 *     → the latest-orders table
 *
 * `openOrders` and `recentOrders` deliberately ignore the 7-day window. A store
 * with one order stuck in `preparing` for 10 days, or one that has been idle for
 * a fortnight, must still show that pending order in the KPI and that order in
 * the table. Windowing them would silently zero out real state.
 *
 * TIMEZONE: Bahrain (UTC+3, no DST) — a fixed offset is exact here and avoids
 * constructing Intl formatters per request. Matches the `timeZone: 'Asia/Bahrain'`
 * formatting the charts used before.
 */

export type OrderRow = {
  id: string;
  status: string;
  total_amount: number;
  type: string;
  order_number: number;
  created_at: string;
  table_id: string | null;
  service_type: string | null;
  tables?: { number: number } | null;
  order_items?: {
    product_name: string;
    quantity: number;
    unit_price: number;
  }[] | null;
};

export type RecentOrder = {
  id: string;
  status: string;
  total_amount: number;
  type: string;
  order_number: number;
  created_at: string;
  table_id: string | null;
  tables?: { number: number } | null;
};

/** Minimal shape for the open-order probe — no items, no amounts needed. */
export type OpenOrder = {
  id: string;
  status: string;
  table_id: string | null;
};

export type ProductStat = { qty: number; revenue: number };
export type HourBucket = { key: string; label: string; revenue: number };
export type DayBucket = { key: string; label: string; revenue: number };

export type RollupInput = {
  /** Orders created within the last 7 days, NEWEST FIRST, with order_items.
   *  Newest-first is a precondition, not a nicety: `recentOrders` is derived
   *  from the head of this array, and the query that feeds it must order by
   *  created_at DESC. */
  windowOrders: OrderRow[];
  /** Every order still pending/preparing/ready, any date. */
  openOrders: OpenOrder[];
  /** The 5 newest orders overall, any date. */
  recentOrders: RecentOrder[];
  /** Epoch ms used as "now" — passed in so the function stays pure. */
  now: number;
  /** Hour key → rendered Arabic label. */
  hourLabels: Map<string, string>;
  /** Day key → rendered Arabic weekday label. */
  dayLabels: Map<string, string>;
};

export type DashboardRollup = {
  recentOrders: RecentOrder[];
  todayOrders: number;
  yesterdayOrders: number;
  todaySales: number;
  yesterdaySales: number;
  pendingCount: number;
  occupiedTableIds: Set<string>;
  byDay7: DayBucket[];
  hourBuckets: HourBucket[];
  peakHour: HourBucket;
  topProducts: Map<string, ProductStat>;
};

/** Bahrain is UTC+3 all year — a constant offset is exact, DST-free. */
export const BAHRAIN_OFFSET_MS = 3 * 3_600_000;

/** 'YYYY-MM-DD' for a timestamp, on Bahrain's calendar. */
export function bahrainDayKey(ts: number): string {
  const d = new Date(ts + BAHRAIN_OFFSET_MS);
  return `${d.getUTCFullYear()}-${p2(d.getUTCMonth() + 1)}-${p2(d.getUTCDate())}`;
}

/** 'YYYY-MM-DDTHH' for a timestamp, on Bahrain's wall clock. */
export function bahrainHourKey(ts: number): string {
  const h = new Date(ts + BAHRAIN_OFFSET_MS).getUTCHours();
  return `${bahrainDayKey(ts)}T${p2(h)}`;
}

function p2(n: number): string {
  return String(n).padStart(2, '0');
}

/** The 7 Bahrain day-keys ending today, oldest first. */
export function last7DayKeys(now: number): string[] {
  // Work entirely in "Bahrain wall clock pretending to be UTC" space: add the
  // offset once, then read getUTC* off it. Calling bahrainDayKey() on an
  // already-shifted date would add the offset a SECOND time and can land the
  // key on the wrong day.
  const shifted = new Date(now + BAHRAIN_OFFSET_MS);
  const base = Date.UTC(shifted.getUTCFullYear(), shifted.getUTCMonth(), shifted.getUTCDate());
  const out: string[] = [];
  for (let i = 6; i >= 0; i--) {
    const d = new Date(base - i * 86_400_000);
    out.push(`${d.getUTCFullYear()}-${p2(d.getUTCMonth() + 1)}-${p2(d.getUTCDate())}`);
  }
  return out;
}

/** The 7 Bahrain hour-keys ending this hour, oldest first. */
export function last7HourKeys(now: number): string[] {
  const base = new Date(now + BAHRAIN_OFFSET_MS);
  base.setUTCMinutes(0, 0, 0);
  const out: string[] = [];
  for (let i = 6; i >= 0; i--) {
    const d = new Date(base.getTime() - i * 3_600_000);
    // Already in Bahrain wall-clock space — read getUTC* directly, never
    // re-shift. (This bug produced keys one day ahead for 21:00-23:00.)
    out.push(`${d.getUTCFullYear()}-${p2(d.getUTCMonth() + 1)}-${p2(d.getUTCDate())}T${p2(d.getUTCHours())}`);
  }
  return out;
}

/**
 * The current instant, captured OUTSIDE the React tree.
 *
 * `react-hooks/purity` flags `Date.now()` during render — correctly: a render
 * that reads the clock makes the output impure. The old code solved this by
 * calling Date.now() inside plain helper functions in lib/dashboard-data.ts,
 * which the rule does not police. This is the same escape hatch, named.
 *
 * Read once per render by the dashboard page and passed into the pure rollup.
 */
export function currentInstant(): number {
  return Date.now();
}

/** Money to 3 decimals — BHD fils. Mirrors the DB's numeric(10,3). */
function round3(n: number): number {
  return Math.round(n * 1000) / 1000;
}

/**
 * One pass over the fetched rows produces every dashboard figure.
 * Pure: no Date.now(), no Intl, no I/O — which is what makes it testable
 * against the old query implementation at a fixed instant.
 */
export function buildDashboardRollup(input: RollupInput): DashboardRollup {
  const { windowOrders, openOrders, recentOrders, now, hourLabels, dayLabels } = input;

  const todayKey = bahrainDayKey(now);
  const yesterdayKey = bahrainDayKey(now - 86_400_000);
  // Same boundary the old `weekAgo` used: gte(now - 7d).
  const windowStart = now - 7 * 86_400_000;

  const byDay7: DayBucket[] = last7DayKeys(now).map((key) => ({
    key,
    label: dayLabels.get(key) ?? key,
    revenue: 0,
  }));
  const dayIndex = new Map(byDay7.map((b, i) => [b.key, i]));

  const hourBuckets: HourBucket[] = last7HourKeys(now).map((key) => ({
    key,
    label: hourLabels.get(key) ?? key,
    revenue: 0,
  }));
  const hourIndex = new Map(hourBuckets.map((b, i) => [b.key, i]));

  const topProducts = new Map<string, ProductStat>();
  let todayOrders = 0;
  let yesterdayOrders = 0;
  let todaySales = 0;
  let yesterdaySales = 0;

  for (const o of windowOrders) {
    const ts = Date.parse(o.created_at);
    if (Number.isNaN(ts) || ts < windowStart) continue;

    // Order COUNTS include cancelled orders — the old queries were
    // `count: exact` with no status filter.
    const dKey = bahrainDayKey(ts);
    if (dKey === todayKey) todayOrders++;
    else if (dKey === yesterdayKey) yesterdayOrders++;

    // Revenue EXCLUDES cancelled orders — the old queries had
    // `.not('status','eq','cancelled')`. This `continue` must come after the
    // counting above, never before it.
    if (o.status === 'cancelled') continue;

    const amount = Number(o.total_amount);
    if (dKey === todayKey) todaySales += amount;
    else if (dKey === yesterdayKey) yesterdaySales += amount;

    const hourIdx = hourIndex.get(bahrainHourKey(ts));
    if (hourIdx !== undefined) hourBuckets[hourIdx].revenue += amount;

    const dayIdx = dayIndex.get(dKey);
    if (dayIdx !== undefined) byDay7[dayIdx].revenue += amount;

    for (const it of o.order_items ?? []) {
      const cur = topProducts.get(it.product_name) ?? { qty: 0, revenue: 0 };
      cur.qty += Number(it.quantity);
      cur.revenue += Number(it.quantity) * Number(it.unit_price ?? 0);
      topProducts.set(it.product_name, cur);
    }
  }

  // Round once, after accumulation. Rounding inside the loop would make the
  // total depend on iteration order and drift away from a SQL SUM.
  for (const [name, stat] of topProducts) {
    topProducts.set(name, { qty: stat.qty, revenue: round3(stat.revenue) });
  }

  // peakHour: on a tie the OLDEST bucket wins, matching
  // `[...hourBuckets].sort((a,b) => b.revenue - a.revenue)[0]` on a
  // chronologically ascending array (Array.sort is stable).
  let peakHour = hourBuckets[0];
  for (const b of hourBuckets) if (b.revenue > peakHour.revenue) peakHour = b;

  // Live state — from openOrders, which is NOT windowed.
  let pendingCount = 0;
  const occupiedTableIds = new Set<string>();
  for (const o of openOrders) {
    if (o.status === 'pending' || o.status === 'preparing') pendingCount++;
    if (o.table_id !== null && o.table_id !== undefined) occupiedTableIds.add(o.table_id);
  }

  return {
    recentOrders,
    todayOrders,
    yesterdayOrders,
    todaySales: round3(todaySales),
    yesterdaySales: round3(yesterdaySales),
    pendingCount,
    occupiedTableIds,
    byDay7,
    hourBuckets,
    peakHour,
    topProducts,
  };
}

/** Live onboarding checklist derived from already-fetched counts — no queries. */
export function checklistFromRollup(
  counts: {
    products: number;
    tables: number;
    /** TOTAL orders for the project, not the 7-day window. The old
     *  `buildChecklist` counted the whole table, so 'test your first order'
     *  must not re-appear just because the store went a week without orders. */
    orders: number;
  },
  project: { name?: string | null; primary_color?: string | null; slug?: string | null }
) {
  const hasBranding = Boolean(project.name && project.primary_color && project.slug);
  return [
    { id: 'product', label: 'أضف أول منتج', done: counts.products > 0, href: '/dashboard/products' },
    { id: 'branding', label: 'تأكيد اسم المتجر والهوية', done: hasBranding, href: '/dashboard/settings' },
    { id: 'table', label: 'أنشئ أول طاولة', done: counts.tables > 0, href: '/dashboard/tables' },
    // QR is generated together with every table (qrcode column always set).
    { id: 'qr', label: 'ولّد أول رمز QR', done: counts.tables > 0, href: '/dashboard/tables' },
    { id: 'order', label: 'اختبر أول طلب', done: counts.orders > 0, href: '/dashboard/orders' },
  ];
}