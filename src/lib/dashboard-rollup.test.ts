/**
 * Parity proof for the dashboard rollup (audit 2026-10-07).
 *
 * The refactor replaces 13 sequential/parallel queries with 3 fetched datasets
 * plus in-memory aggregation. That is only safe if it produces IDENTICAL numbers.
 *
 * This test keeps a verbatim transcription of the ORIGINAL per-query
 * implementation and asserts the new one matches it field by field, across four
 * real "now" instants chosen to hit the awkward boundaries: Bahrain midnight,
 * the hour either side of it, and a UTC day that is a different Bahrain day.
 *
 * It also pins the behaviours that are easy to regress silently:
 *   - cancelled orders count toward order counts but never toward revenue,
 *   - the 7-day window is inclusive at the start (gte, not gt),
 *   - live state (pending, occupied tables) is NOT windowed to 7 days,
 *   - a tied peak hour resolves to the OLDEST bucket,
 *   - day/hour keys cut at Bahrain midnight (UTC+3), not UTC.
 */
import { describe, it, expect } from 'vitest';
import {
  buildDashboardRollup,
  bahrainDayKey,
  bahrainHourKey,
  last7DayKeys,
  last7HourKeys,
  checklistFromRollup,
  type OrderRow,
  type OpenOrder,
  type RecentOrder,
} from './dashboard-rollup';

const NOW_ISHES = [
  Date.parse('2026-10-07T12:00:00Z'),
  Date.parse('2026-10-06T21:30:00Z'), // 00:30 Bahrain on the 7th — midnight edge
  Date.parse('2026-10-07T02:00:00Z'), // 05:00 Bahrain
  Date.parse('2026-10-06T20:59:00Z'), // 23:59 Bahrain on the 6th — just before
];

// ---------------------------------------------------------------------------
// Fixture
// ---------------------------------------------------------------------------
/** Build an ISO timestamp that is `hour` Bahrain time, `daysAgo` days back. */
function bh(daysAgo: number, hour: number, min = 0): string {
  const off = 3 * 3_600_000;
  const s = new Date(NOW_ISHES[0] + off);
  const base = Date.UTC(s.getUTCFullYear(), s.getUTCMonth(), s.getUTCDate());
  return new Date(base - daysAgo * 86_400_000 + hour * 3_600_000 + min * 60_000 - off).toISOString();
}

function fixture(): OrderRow[] {
  const o = (
    i: number,
    daysAgo: number,
    hour: number,
    status: string,
    table: number | null,
    amount: number,
    items: { product_name: string; quantity: number; unit_price: number }[]
  ): OrderRow => ({
    id: `o${i}`,
    status,
    total_amount: amount,
    type: table === null ? 'drivethru' : 'dinein',
    order_number: i,
    created_at: bh(daysAgo, hour),
    table_id: table === null ? null : `t${table}`,
    service_type: null,
    tables: table === null ? null : { number: table },
    order_items: items,
  });

  return [
    o(1, 0, 10, 'delivered', 1, 5.0, [{ product_name: 'قهوة', quantity: 2, unit_price: 2.5 }]),
    o(2, 0, 11, 'pending', 1, 3.5, [{ product_name: 'كبسة', quantity: 1, unit_price: 3.5 }]),
    // Cancelled, today: must raise the order count, must NOT raise revenue.
    o(3, 0, 11, 'cancelled', 2, 99.0, [{ product_name: 'شاي', quantity: 9, unit_price: 11 }]),
    o(4, 0, 12, 'ready', 2, 7.25, [{ product_name: 'قهوة', quantity: 1, unit_price: 1.25 }]),
    o(5, 1, 9, 'delivered', 3, 4.0, [{ product_name: 'كبسة', quantity: 2, unit_price: 2 }]),
    o(6, 1, 23, 'cancelled', null, 50.0, []),
    o(7, 2, 20, 'preparing', 4, 6.5, [{ product_name: 'شاي', quantity: 3, unit_price: 2 }]),
    o(8, 3, 15, 'delivered', null, 2.0, [{ product_name: 'قهوة', quantity: 4, unit_price: 0.5 }]),
    o(9, 6, 8, 'delivered', 5, 8.0, [{ product_name: 'كبسة', quantity: 1, unit_price: 8 }]),
    // Exactly 7 days back — inside the window (gte, not gt).
    o(10, 7, 8, 'delivered', 6, 100.0, [{ product_name: 'قهوة', quantity: 50, unit_price: 2 }]),
    // Well outside the window.
    o(11, 30, 8, 'delivered', 7, 1000.0, [{ product_name: 'قهوة', quantity: 99, unit_price: 10 }]),
  ];
}

/** Split the fixture into the three datasets the page now fetches in parallel. */
function datasets(orders: OrderRow[]) {
  const weekAgo = NOW_ISHES[0] - 7 * 86_400_000;
  const windowOrders = orders
    .filter((o) => Date.parse(o.created_at) >= weekAgo)
    .sort((a, b) => (a.created_at < b.created_at ? 1 : -1));

  const openOrders: OpenOrder[] = orders
    .filter((o) => ['pending', 'preparing', 'ready'].includes(o.status))
    .map((o) => ({ id: o.id, status: o.status, table_id: o.table_id }));

  const recentOrders: RecentOrder[] = [...orders]
    .sort((a, b) => (a.created_at < b.created_at ? 1 : -1))
    .slice(0, 5);

  return { windowOrders, openOrders, recentOrders };
}

function labelMaps(now: number) {
  const hourFmt = new Intl.DateTimeFormat('en-CA', {
    timeZone: 'Asia/Bahrain',
    year: 'numeric', month: '2-digit', day: '2-digit',
    hour: '2-digit', hourCycle: 'h23',
  });
  const hourLabel = new Intl.DateTimeFormat('ar-BH', {
    numberingSystem: 'latn', hour: 'numeric', timeZone: 'Asia/Bahrain',
  });
  const hourLabels = new Map<string, string>();
  for (let i = 6; i >= 0; i--) {
    const d = new Date(now - i * 3_600_000);
    const p = hourFmt.formatToParts(d);
    const g = (t: string) => p.find((x) => x.type === t)?.value ?? '';
    hourLabels.set(
      `${g('year')}-${g('month')}-${g('day')}T${g('hour').padStart(2, '0')}`,
      hourLabel.format(d)
    );
  }
  const dayLabels = new Map(last7DayKeys(now).map((k) => [k, k]));
  return { hourLabels, dayLabels };
}

/** Bahrain midnight boundaries as ISO strings — what the old queries filtered on. */
function dayBounds(now: number) {
  const off = 3 * 3_600_000;
  const s = new Date(now + off);
  const start = Date.UTC(s.getUTCFullYear(), s.getUTCMonth(), s.getUTCDate()) - off;
  return {
    todayIso: new Date(start).toISOString(),
    tomorrowIso: new Date(start + 86_400_000).toISOString(),
    yesterdayIso: new Date(start - 86_400_000).toISOString(),
  };
}

// ---------------------------------------------------------------------------
// Reference: the ORIGINAL per-query implementation, transcribed from
// src/app/dashboard/page.tsx as it stood before the refactor.
// ---------------------------------------------------------------------------
function referenceImpl(orders: OrderRow[], now: number) {
  const dayFmt = new Intl.DateTimeFormat('en-CA', {
    timeZone: 'Asia/Bahrain',
    year: 'numeric', month: '2-digit', day: '2-digit',
  });
  const { todayIso, tomorrowIso, yesterdayIso } = dayBounds(now);

  // kpi5 todaySales: service_type null, NOT cancelled, today range.
  const todaySalesData = orders.filter(
    (o) => o.service_type === null && o.status !== 'cancelled' &&
           o.created_at >= todayIso && o.created_at < tomorrowIso
  );
  // kpi6 yesterdaySales
  const yesterdaySalesData = orders.filter(
    (o) => o.service_type === null && o.status !== 'cancelled' &&
           o.created_at >= yesterdayIso && o.created_at < todayIso
  );

  const todayOrders = orders.filter(
    (o) => o.service_type === null && o.created_at >= todayIso && o.created_at < tomorrowIso
  ).length;
  const yesterdayOrders = orders.filter(
    (o) => o.service_type === null && o.created_at >= yesterdayIso && o.created_at < todayIso
  ).length;

  // kpi4 pendingCount: NO date filter at all.
  const pendingCount = orders.filter(
    (o) => o.service_type === null && (o.status === 'pending' || o.status === 'preparing')
  ).length;

  // kpi8 openTableOrders: NO date filter, statuses pending|preparing|ready.
  const occupied = new Set(
    orders
      .filter(
        (o) => o.service_type === null && o.table_id !== null &&
               ['pending', 'preparing', 'ready'].includes(o.status)
      )
      .map((o) => o.table_id as string)
  );

  // kpi3 recent 5: newest first, NO date filter.
  const recent = [...orders]
    .filter((o) => o.service_type === null)
    .sort((a, b) => (a.created_at < b.created_at ? 1 : -1))
    .slice(0, 5)
    .map((r) => r.id);

  // Hourly chart, fed from todaySalesData.
  const hFmt = new Intl.DateTimeFormat('en-CA', {
    timeZone: 'Asia/Bahrain',
    year: 'numeric', month: '2-digit', day: '2-digit',
    hour: '2-digit', hourCycle: 'h23',
  });
  const hLabel = new Intl.DateTimeFormat('ar-BH', {
    numberingSystem: 'latn', hour: 'numeric', timeZone: 'Asia/Bahrain',
  });
  const buckets: { key: string; revenue: number }[] = [];
  for (let i = 6; i >= 0; i--) {
    const d = new Date(now - i * 3_600_000);
    const p = hFmt.formatToParts(d);
    const g = (t: string) => p.find((x) => x.type === t)?.value ?? '';
    buckets.push({ key: `${g('year')}-${g('month')}-${g('day')}T${g('hour').padStart(2, '0')}`, revenue: 0 });
  }
  const hIndex = new Map(buckets.map((b, i) => [b.key, i]));
  for (const o of todaySalesData) {
    const p = hFmt.formatToParts(new Date(o.created_at));
    const g = (t: string) => p.find((x) => x.type === t)?.value ?? '';
    const i = hIndex.get(`${g('year')}-${g('month')}-${g('day')}T${g('hour').padStart(2, '0')}`);
    if (i !== undefined) buckets[i].revenue += Number(o.total_amount);
  }
  const peak = [...buckets].sort((a, b) => b.revenue - a.revenue)[0];

  // 7-day chart + top products: gte(now - 7d), cancelled skipped for BOTH.
  const weekAgoIso = new Date(now - 7 * 86_400_000).toISOString();
  const dayKeys: string[] = [];
  for (let i = 6; i >= 0; i--) dayKeys.push(dayFmt.format(new Date(now - i * 86_400_000)));
  const byDay7 = dayKeys.map((k) => ({ key: k, revenue: 0 }));
  const top = new Map<string, { qty: number; revenue: number }>();
  for (const o of orders.filter((x) => x.service_type === null && x.created_at >= weekAgoIso)) {
    if (o.status === 'cancelled') continue;
    const d = byDay7.find((x) => x.key === dayFmt.format(new Date(o.created_at)));
    if (d) d.revenue += Number(o.total_amount);
    for (const it of o.order_items ?? []) {
      const c = top.get(it.product_name) ?? { qty: 0, revenue: 0 };
      c.qty += Number(it.quantity);
      c.revenue += Number(it.quantity) * Number(it.unit_price ?? 0);
      top.set(it.product_name, c);
    }
  }

  const r3 = (n: number) => Math.round(n * 1000) / 1000;
  return {
    todayOrders,
    yesterdayOrders,
    todaySales: r3(todaySalesData.reduce((s, o) => s + Number(o.total_amount), 0)),
    yesterdaySales: r3(yesterdaySalesData.reduce((s, o) => s + Number(o.total_amount), 0)),
    pendingCount,
    occupiedCount: occupied.size,
    recent,
    hourBuckets: buckets.map((b) => ({ key: b.key, revenue: r3(b.revenue) })),
    peakKey: peak.key,
    byDay7: byDay7.map((d) => ({ key: d.key, revenue: r3(d.revenue) })),
    top: [...top.entries()]
      .sort((a, b) => b[1].revenue - a[1].revenue)
      .slice(0, 3)
      .map(([name, v]) => ({ name, qty: v.qty, revenue: r3(v.revenue) })),
  };
}

// ---------------------------------------------------------------------------
describe('dashboard rollup — parity with the 13-query implementation', () => {
  for (const now of NOW_ISHES) {
    it(`matches the reference at now=${new Date(now).toISOString()}`, () => {
      const orders = fixture();
      const ref = referenceImpl(orders, now);

      // The page's three datasets, fetched newest-first as the queries do.
      const weekAgoIso = new Date(now - 7 * 86_400_000).toISOString();
      const windowOrders = orders
        .filter((o) => o.service_type === null && o.created_at >= weekAgoIso)
        .sort((a, b) => (a.created_at < b.created_at ? 1 : -1));
      const openOrders: OpenOrder[] = orders
        .filter((o) => o.service_type === null && ['pending', 'preparing', 'ready'].includes(o.status))
        .map((o) => ({ id: o.id, status: o.status, table_id: o.table_id }));
      const recentOrders: RecentOrder[] = [...orders]
        .filter((o) => o.service_type === null)
        .sort((a, b) => (a.created_at < b.created_at ? 1 : -1))
        .slice(0, 5);

      const { hourLabels, dayLabels } = labelMaps(now);
      const got = buildDashboardRollup({ windowOrders, openOrders, recentOrders, now, hourLabels, dayLabels });

      expect(got.todayOrders).toBe(ref.todayOrders);
      expect(got.yesterdayOrders).toBe(ref.yesterdayOrders);
      expect(got.todaySales).toBe(ref.todaySales);
      expect(got.yesterdaySales).toBe(ref.yesterdaySales);
      expect(got.pendingCount).toBe(ref.pendingCount);
      expect(got.occupiedTableIds.size).toBe(ref.occupiedCount);
      expect(got.recentOrders.map((r) => r.id)).toEqual(ref.recent);
      expect(got.hourBuckets.map((b) => ({ key: b.key, revenue: b.revenue }))).toEqual(ref.hourBuckets);
      expect(got.peakHour.key).toBe(ref.peakKey);
      expect(got.byDay7.map((d) => ({ key: d.key, revenue: d.revenue }))).toEqual(ref.byDay7);

      const top = [...got.topProducts.entries()]
        .sort((a, b) => b[1].revenue - a[1].revenue)
        .slice(0, 3)
        .map(([name, v]) => ({ name, qty: v.qty, revenue: v.revenue }));
      expect(top).toEqual(ref.top);
    });
  }

  it('recentOrders come from the newest-first dataset, not the 7-day window', () => {
    const now = NOW_ISHES[0];
    const orders = fixture();
    const d = datasets(orders);
    const got = buildDashboardRollup({ ...d, now, ...labelMaps(now) });
    // o6 (yesterday) and o4 must both survive even though a 7-day-only fetch
    // would have had to filter; more importantly the ORDER is newest-first.
    expect(got.recentOrders.map((r) => r.id)).toEqual(
      [...orders].sort((a, b) => (a.created_at < b.created_at ? 1 : -1)).slice(0, 5).map((r) => r.id)
    );
  });

  it('keeps an order stuck in preparing for 10 days in the KPI', () => {
    const now = NOW_ISHES[0];
    const stale: OrderRow = {
      id: 'stale', status: 'preparing', total_amount: 4, type: 'dinein', order_number: 99,
      created_at: bh(10, 12), table_id: 't9', service_type: null,
      tables: { number: 9 }, order_items: [],
    };
    const orders = [stale, ...fixture()];
    const d = datasets(orders);
    const got = buildDashboardRollup({ ...d, now, ...labelMaps(now) });
    // If pending/occupied were windowed to 7 days this would be 0.
    expect(got.pendingCount).toBeGreaterThan(0);
    expect(got.occupiedTableIds.has('t9')).toBe(true);
    // ...but it must not leak into today's revenue (o1+o2+o4 = 5.0+3.5+7.25).
    expect(got.todaySales).toBe(15.75);
  });

  it('cancelled orders count as orders but never as revenue', () => {
    const now = NOW_ISHES[0];
    const got = buildDashboardRollup({ ...datasets(fixture()), now, ...labelMaps(now) });
    expect(got.todayOrders).toBe(4); // o1..o4 — o3 is cancelled and still counts
    expect(got.todaySales).toBe(15.75); // 5.0 + 3.5 + 7.25 — o3's 99 is excluded
  });

  it('includes the 7-day boundary itself (gte, not gt)', () => {
    const now = NOW_ISHES[0];
    const boundary = new Date(now - 7 * 86_400_000).toISOString();
    // One order EXACTLY on the boundary, one 1ms older. The old query was
    // `.gte('created_at', weekAgo)`, so the boundary order belongs in the top-3
    // and the 1ms-older one does not.
    const edge: OrderRow[] = [
      { id: 'edge-in', status: 'delivered', total_amount: 1, type: 'drivethru', order_number: 1,
        created_at: boundary, table_id: null, service_type: null,
        order_items: [{ product_name: 'داخل الحد', quantity: 7, unit_price: 1 }] },
      { id: 'edge-out', status: 'delivered', total_amount: 1, type: 'drivethru', order_number: 2,
        created_at: new Date(Date.parse(boundary) - 1).toISOString(), table_id: null, service_type: null,
        order_items: [{ product_name: 'خارج الحد', quantity: 99, unit_price: 1 }] },
    ];
    const got = buildDashboardRollup({ ...datasets(edge), now, ...labelMaps(now) });
    expect(got.topProducts.has('داخل الحد')).toBe(true);
    expect(got.topProducts.has('خارج الحد')).toBe(false);
  });

  it('a tied peak hour resolves to the OLDEST bucket', () => {
    const now = NOW_ISHES[0];
    // Two orders, same amount, hours apart — with the last-7-hour window both
    // land in buckets that tie.
    const orders: OrderRow[] = [
      { id: 'a', status: 'delivered', total_amount: 10, type: 'dinein', order_number: 1,
        created_at: new Date(now - 2 * 3_600_000).toISOString(), table_id: null, service_type: null, order_items: [] },
      { id: 'b', status: 'delivered', total_amount: 10, type: 'dinein', order_number: 2,
        created_at: new Date(now - 1 * 3_600_000).toISOString(), table_id: null, service_type: null, order_items: [] },
    ];
    const got = buildDashboardRollup({ ...datasets(orders), now, ...labelMaps(now) });
    const tied = got.hourBuckets.filter((b) => b.revenue === 10);
    expect(tied).toHaveLength(2);
    expect(got.peakHour.key).toBe(tied[0].key);
  });
});

describe('Bahrain day/hour keys', () => {
  it('cut days at Bahrain midnight (UTC+3), not UTC', () => {
    expect(bahrainDayKey(Date.parse('2026-10-06T21:30:00Z'))).toBe('2026-10-07');
    expect(bahrainDayKey(Date.parse('2026-10-06T20:59:00Z'))).toBe('2026-10-06');
    expect(bahrainDayKey(Date.parse('2026-10-07T00:00:00Z'))).toBe('2026-10-07');
  });

  it('hour keys are zero-padded Bahrain hours', () => {
    expect(bahrainHourKey(Date.parse('2026-10-07T01:05:00Z'))).toBe('2026-10-07T04');
    expect(bahrainHourKey(Date.parse('2026-10-07T12:00:00Z'))).toBe('2026-10-07T15');
  });

  it('last7DayKeys returns 7 ascending keys ending today', () => {
    const keys = last7DayKeys(NOW_ISHES[0]);
    expect(keys).toEqual(['2026-10-01', '2026-10-02', '2026-10-03', '2026-10-04', '2026-10-05', '2026-10-06', '2026-10-07']);
  });

  it('last7HourKeys returns 7 ascending keys ending this hour', () => {
    expect(last7HourKeys(Date.parse('2026-10-07T12:40:00Z'))).toEqual([
      '2026-10-07T09', '2026-10-07T10', '2026-10-07T11',
      '2026-10-07T12', '2026-10-07T13', '2026-10-07T14', '2026-10-07T15',
    ]);
  });
});

describe('checklistFromRollup', () => {
  it('branding needs name + primary_color + slug', () => {
    const mk = (p: object) =>
      checklistFromRollup({ products: 1, tables: 1, orders: 1 }, p).find((c) => c.id === 'branding')!.done;
    expect(mk({ name: 'a', primary_color: '#fff', slug: 'a' })).toBe(true);
    expect(mk({ name: 'a', primary_color: null, slug: 'a' })).toBe(false);
    expect(mk({ name: '', primary_color: '#fff', slug: 'a' })).toBe(false);
    expect(mk({ name: 'a', primary_color: '#fff', slug: '' })).toBe(false);
  });

  it('the order item depends on the TOTAL order count, not the 7-day window', () => {
    // Regression guard: an earlier draft read todayOrders+yesterdayOrders, which
    // made 'test your first order' reappear whenever the store went quiet.
    const items = checklistFromRollup(
      { products: 1, tables: 1, orders: 5 },
      { name: 'a', primary_color: '#fff', slug: 'a' }
    );
    expect(items.find((c) => c.id === 'order')!.done).toBe(true);
    const quiet = checklistFromRollup(
      { products: 0, tables: 0, orders: 0 },
      { name: '', primary_color: null, slug: '' }
    );
    expect(quiet.every((c) => !c.done)).toBe(true);
  });
});