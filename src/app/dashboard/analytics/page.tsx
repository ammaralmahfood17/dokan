import { requireCurrentProjectRole } from '@/lib/project';
import { createClient } from '@/lib/supabase/server';
import { AnalyticsClient } from './analytics-client';

export type Range = 'today' | '7d' | '30d';

export const dynamic = 'force-dynamic';

type OrderRow = {
  id: string;
  status: string;
  total_amount: number;
  type: string;
  created_at: string;
  order_items?: { product_name: string; quantity: number; unit_price?: number | null }[] | null;
};

export type AnalyticsData = {
  kpi: {
    orders: number;
    revenue: number;
    avgOrder: number;
    cancelled: number;
  };
  prevKpi: {
    orders: number;
    revenue: number;
    avgOrder: number;
    cancelled: number;
  };
  byDay: { key: string; label: string; revenue: number; count: number }[];
  byHour: { label: string; count: number }[];
  topProducts: { name: string; quantity: number; revenue: number }[];
  byType: { type: string; count: number }[];
};

const TYPE_AR: Record<string, string> = {
  walkin: 'سفري',
  drivethru: 'سيارة',
  dinein: 'طاولة',
};

// ── Gulf timezone bucketing ────────────────────────────────────────────────
// Supabase stores timestamptz (UTC). Bucketing with the server's local time
// (Vercel = UTC) would put a 1AM Bahrain order on the PREVIOUS day and shift
// peak-hour stats by 3 hours. Bucket by Asia/Bahrain (UTC+3) instead.
// Multi-Gulf per-project timezone support = future enhancement.
const TZ = 'Asia/Bahrain';
const dayFmt = new Intl.DateTimeFormat('en-CA', { timeZone: TZ, year: 'numeric', month: '2-digit', day: '2-digit' });
const hourFmt = new Intl.DateTimeFormat('en-GB', { timeZone: TZ, hour: 'numeric', hour12: false });
const arWeekdayFmt = new Intl.DateTimeFormat('ar', { numberingSystem: 'latn', timeZone: TZ, weekday: 'long' });

function tzDayKey(d: Date): string {
  return dayFmt.format(d); // YYYY-MM-DD in Asia/Bahrain
}
function tzHour(d: Date): number {
  return Number(hourFmt.format(d)) % 24;
}

/**
 * Compute the current + previous period boundaries.
 * Lives OUTSIDE the component so the impure `new Date()`/`Date.now()` calls
 * stay out of the render body (react-hooks purity rule) — safe here because
 * this is a force-dynamic server component re-rendered per request.
 */
function getRangeBounds(count: number, range: Range) {
  // "Today" at Asia/Bahrain midnight → UTC instant, then walk back N days.
  const [y, m, d] = tzDayKey(new Date()).split('-').map(Number);
  const todayUTCms = Date.UTC(y, m - 1, d);
  const startUTC = new Date(todayUTCms - (count - 1) * 86400000);

  // Previous period (for comparison): same length, immediately before `startUTC`
  // For 'today': compare with the SAME TIME WINDOW of yesterday (00:00 → now-24h),
  // otherwise at 11AM today vs full yesterday always looks like a crash.
  const prevEnd =
    range === 'today'
      ? new Date(Date.now() - 24 * 3600000)
      : new Date(startUTC.getTime() - 1);
  const prevStart =
    range === 'today'
      ? new Date(todayUTCms - 86400000)
      : new Date(startUTC.getTime() - count * 86400000);

  return { todayUTCms, startUTC, prevEnd, prevStart };
}

export default async function AnalyticsPage({
  searchParams,
}: {
  searchParams: Promise<{ range?: string }>;
}) {
  const { range: rangeParam } = await searchParams;
  const range: Range = rangeParam === 'today' || rangeParam === '30d' ? rangeParam : '7d';

  const ctx = await requireCurrentProjectRole(['owner', 'manager']);

  const count = range === 'today' ? 1 : range === '7d' ? 7 : 30;

  // Date-range bounds computed in a plain helper (keeps impure Date calls
  // out of the render body).
  const { todayUTCms, startUTC, prevEnd, prevStart } = getRangeBounds(count, range);

  const supabase = await createClient();

  // Fetch ALL orders in range, paged — a plain limit(2000) would silently
  // undercount busy 30-day windows (revenue + top products truncated, no warning).
  const PAGE = 1000;
  const collectOrders = async (select: string, start: Date, end?: Date) => {
    const all: Record<string, unknown>[] = [];
    let from = 0;
    for (;;) {
      let q = supabase
        .from('orders')
        .select(select)
        .eq('project_id', ctx.project.id)
        .is('service_type', null)
        .gte('created_at', start.toISOString())
        .order('created_at', { ascending: false })
        .range(from, from + PAGE - 1);
      if (end) q = q.lt('created_at', end.toISOString());
      const { data, error } = await q;
      if (error) return { data: null, error };
      if (!data || data.length === 0) break;
      all.push(...(data as unknown as Record<string, unknown>[]));
      if (data.length < PAGE) break;
      from += PAGE;
    }
    return { data: all, error: null };
  };

  const [{ data, error }, { data: prevData, error: prevError }] = await Promise.all([
    collectOrders(
      'id, status, total_amount, type, created_at, order_items(product_name, quantity, unit_price)',
      startUTC
    ),
    collectOrders('id, status, total_amount', prevStart, prevEnd),
  ]);

  const orders = (data ?? []) as unknown as OrderRow[];
  const prevOrders = (prevData ?? []) as unknown as OrderRow[];
  const fetchError = error || prevError ? 'تعذر تحميل البيانات' : null;

  // ---- KPI helper ----
  const computeKpi = (list: OrderRow[]) => {
    const active = list.filter((o) => o.status !== 'cancelled');
    const revenue = active.reduce((s, o) => s + Number(o.total_amount || 0), 0);
    return {
      orders: list.length,
      revenue,
      avgOrder: active.length ? revenue / active.length : 0,
      cancelled: list.length - active.length,
    };
  };

  const kpi = computeKpi(orders);
  const prevKpi = computeKpi(prevOrders);
  const active = orders.filter((o) => o.status !== 'cancelled');

  // ---- Revenue by day (Asia/Bahrain buckets, oldest → newest) ----
  const dayMap = new Map<string, { key: string; label: string; revenue: number; count: number }>();
  for (let i = count - 1; i >= 0; i--) {
    const t = new Date(todayUTCms - i * 86400000);
    const k = tzDayKey(t);
    dayMap.set(k, { key: k, label: arWeekdayFmt.format(t), revenue: 0, count: 0 });
  }
  for (const o of active) {
    const bucket = dayMap.get(tzDayKey(new Date(o.created_at)));
    if (bucket) {
      bucket.revenue += Number(o.total_amount || 0);
      bucket.count += 1;
    }
  }
  const byDay = [...dayMap.values()];

  // ---- Orders by hour (0-23, Asia/Bahrain) ----
  const hourBuckets = Array.from({ length: 24 }, (_, h) => ({ label: String(h), count: 0 }));
  for (const o of active) {
    hourBuckets[tzHour(new Date(o.created_at))].count += 1;
  }
  const byHour = hourBuckets;

  // ---- Top products (only active orders) — quantity + revenue ----
  const productMap = new Map<string, { quantity: number; revenue: number }>();
  for (const o of active) {
    for (const item of o.order_items ?? []) {
      const qty = Number(item.quantity || 1);
      const rev = qty * Number(item.unit_price || 0);
      const cur = productMap.get(item.product_name) ?? { quantity: 0, revenue: 0 };
      productMap.set(item.product_name, {
        quantity: cur.quantity + qty,
        revenue: cur.revenue + rev,
      });
    }
  }
  const topProducts = [...productMap.entries()]
    .map(([name, v]) => ({ name, quantity: v.quantity, revenue: v.revenue }))
    .sort((a, b) => b.quantity - a.quantity)
    .slice(0, 8);

  // ---- By type ----
  // NOTE: counts ALL orders (including cancelled) — intentionally consistent
  // with the "الطلبات" KPI total. Revenue/avg/top-products exclude cancelled.
  const typeMap = new Map<string, number>();
  for (const o of orders) {
    typeMap.set(o.type, (typeMap.get(o.type) ?? 0) + 1);
  }
  const byType = [...typeMap.entries()]
    .map(([type, count]) => ({ type: TYPE_AR[type] ?? type, count }))
    .sort((a, b) => b.count - a.count);

  const data_: AnalyticsData = { kpi, prevKpi, byDay, byHour, topProducts, byType };

  return (
    <AnalyticsClient
      range={range}
      currency={ctx.project.currency}
      data={data_}
      projectName={ctx.project.name}
      fetchError={fetchError}
    />
  );
}
