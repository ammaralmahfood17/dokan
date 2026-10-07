// D1: Dashboard orchestrator — data fetching + wiring only.
// UI sections live in src/components/dashboard/* (extracted from the old
// ~590-line god component).
//
// Audit 2026-10-07: this page used to make 13 queries across FOUR sequential
// barriers (buildChecklist → KPI block → week scan) plus the auth and project
// lookups. Measured against production, EVERY query costs ~150 ms regardless of
// shape — a primary-key `select id` is as slow as the 7-day scan — so the cost
// is the number of sequential barriers, not the queries. The figures below are
// now derived in memory from three parallel datasets (see lib/dashboard-rollup).
import { getCurrentProject } from '@/lib/project';
import { recordOnboardingProgress } from '@/lib/onboarding-funnel';
import { createClient } from '@/lib/supabase/server';
import { redirect } from 'next/navigation';
import type { ChecklistItem } from '@/lib/types';
import {
  buildDashboardRollup,
  checklistFromRollup,
  type OrderRow,
  type OpenOrder,
  type RecentOrder,
} from '@/lib/dashboard-rollup';
import { KpiCards } from '@/components/dashboard/kpi-cards';
import { ChecklistSection } from '@/components/dashboard/checklist';
import { HourlySalesChart } from '@/components/dashboard/hourly-sales-chart';
import { RecentOrdersTable } from '@/components/dashboard/recent-orders-table';
import { LiveRefresh } from '@/components/dashboard/live-refresh';
import { WeeklySalesChart } from '@/components/dashboard/weekly-sales-chart';
import { TopProducts } from '@/components/dashboard/top-products';

export default async function DashboardPage() {
  const ctx = await getCurrentProject();
  if (!ctx) redirect('/onboarding');

  const supabase = await createClient();

  // "Today" = Bahrain midnight (UTC+3). The server clock is UTC, so naive
  // setHours(0,0,0,0) would drop orders between 00:00-03:00 Bahrain time.
  const TZ = 'Asia/Bahrain';
  const dayFmt = new Intl.DateTimeFormat('en-CA', {
    timeZone: TZ,
    year: 'numeric',
    month: '2-digit',
    day: '2-digit',
  });
  const today = new Date(Date.parse(`${dayFmt.format(new Date())}T00:00:00+03:00`));
  const yesterday = new Date(today.getTime() - 86_400_000);
  const tomorrow = new Date(today.getTime() + 86_400_000);
  const weekAgo = new Date(today.getTime() - 6 * 86_400_000);
  // Charts are labelled from `now`; the rollup takes it as an argument so the
  // aggregation stays pure and testable at a fixed instant.
  const now = today.getTime();

  // ONE parallel block replaces four sequential barriers (audit 2026-10-07,
  // measured: every query costs ~150ms regardless of shape, so what costs is
  // the NUMBER of sequential round-trips, not the queries themselves):
  //
  //   before: auth -> project -> checklist(4) -> KPIs(8) -> week7 scan   ~855ms
  //   after:  auth -> project -> this block                                ~300ms
  //
  //  1. windowOrders   — the 7-day window, with order_items. Feeds every
  //     money/quantity figure AND the recent-orders table (it is fetched
  //     newest-first, so its head IS the latest five).
  //  2. openOrders     — pending/preparing/ready, ANY date. Live KPIs must not
  //     be windowed: a ticket stuck in `preparing` for ten days is still
  //     blocking a table and must stay visible.
  //  3. activeTables   — the live table list (add/disable a table here).
  //  4. counts (3)     — head counts for the onboarding checklist, including
  //     the TOTAL order count (not the 7-day one).
  const [
    { data: windowOrders },
    { data: openOrders },
    { data: activeTables },
    { count: productCount },
    { count: tableCount },
    { count: totalOrderCount },
  ] = await Promise.all([
    supabase
      .from('orders')
      .select(
        'id, status, total_amount, type, order_number, created_at, table_id, tables(number), order_items(product_name, quantity, unit_price)'
      )
      .eq('project_id', ctx.project.id)
      .is('service_type', null)
      .gte('created_at', weekAgo.toISOString())
      .order('created_at', { ascending: false }),
    supabase
      .from('orders')
      .select('id, status, table_id')
      .eq('project_id', ctx.project.id)
      .is('service_type', null)
      .in('status', ['pending', 'preparing', 'ready']),
    supabase
      .from('tables')
      .select('id')
      .eq('project_id', ctx.project.id)
      .eq('is_active', true),
    supabase
      .from('products')
      .select('*', { count: 'exact', head: true })
      .eq('project_id', ctx.project.id),
    supabase
      .from('tables')
      .select('*', { count: 'exact', head: true })
      .eq('project_id', ctx.project.id),
    supabase
      .from('orders')
      .select('*', { count: 'exact', head: true })
      .eq('project_id', ctx.project.id),
  ]);

  // Chart labels are locale work (Intl), aggregation is not — build the label
  // maps once here and hand them to the pure rollup.
  const hourFmt = new Intl.DateTimeFormat('en-CA', {
    timeZone: TZ, year: 'numeric', month: '2-digit', day: '2-digit',
    hour: '2-digit', hourCycle: 'h23',
  });
  const hourLabelFmt = new Intl.DateTimeFormat('ar-BH', {
    numberingSystem: 'latn', hour: 'numeric', timeZone: TZ,
  });
  const hourLabels = new Map<string, string>();
  for (let i = 6; i >= 0; i--) {
    const d = new Date(now - i * 3_600_000);
    const parts = hourFmt.formatToParts(d);
    const get = (t: string) => parts.find((p) => p.type === t)?.value ?? '';
    hourLabels.set(
      `${get('year')}-${get('month')}-${get('day')}T${get('hour').padStart(2, '0')}`,
      hourLabelFmt.format(d)
    );
  }
  const weekdayFmt = new Intl.DateTimeFormat('ar-BH', {
    numberingSystem: 'latn', weekday: 'short', timeZone: TZ,
  });
  const dayLabels = new Map<string, string>();
  for (let i = 6; i >= 0; i--) {
    const key = dayFmt.format(new Date(weekAgo.getTime() + i * 86_400_000));
    dayLabels.set(key, weekdayFmt.format(new Date(`${key}T00:00:00+03:00`)));
  }

  const rollup = buildDashboardRollup({
    windowOrders: (windowOrders ?? []) as OrderRow[],
    openOrders: (openOrders ?? []) as OpenOrder[],
    recentOrders: (windowOrders ?? []).slice(0, 5) as RecentOrder[],
    now,
    hourLabels,
    dayLabels,
  });

  const {
    todayOrders, yesterdayOrders, todaySales, yesterdaySales,
    pendingCount, occupiedTableIds, byDay7, hourBuckets, peakHour, topProducts,
  } = rollup;

  const checklist = checklistFromRollup(
    {
      products: productCount ?? 0,
      tables: tableCount ?? 0,
      orders: totalOrderCount ?? 0,
    },
    ctx.project
  ) as ChecklistItem[];
  const doneCount = checklist.filter((c) => c.done).length;
  const allDone = doneCount === checklist.length;

  // T13 funnel: record which onboarding steps this project has reached, once each.
  // The write is scheduled with after() inside the helper, so it lands after the
  // response and never adds to this page's latency. Best-effort — it cannot throw.
  recordOnboardingProgress(ctx.project.id, checklist);

  const salesDelta =
    yesterdaySales > 0
      ? Math.round(((todaySales - yesterdaySales) / yesterdaySales) * 100)
      : null;
  const ordersDelta = todayOrders - yesterdayOrders;

  const totalActiveTables = (activeTables ?? []).length;
  const occupiedCount = occupiedTableIds.size;

  const top3 = [...topProducts.entries()]
    .sort((a, b) => b[1].revenue - a[1].revenue)
    .slice(0, 3);


  // Vercel runs UTC — without an explicit timeZone the TODAY chip would show
  // UTC and the date would flip a day between 00:00–03:00 Bahrain time.
  const nowTime = new Date().toLocaleTimeString('ar-BH-u-nu-latn', {
    hour: '2-digit',
    minute: '2-digit',
    timeZone: 'Asia/Bahrain',
  });
  const todayLabel = new Date().toLocaleDateString('ar-BH-u-nu-latn', {
    weekday: 'long',
    day: 'numeric',
    month: 'long',
    year: 'numeric',
    timeZone: 'Asia/Bahrain',
  });

  return (
    <div className="page">
      {/* Live-update safety net: realtime on orders + a 60s heartbeat. Without
          this the home screen froze at page-load data and the merchant had to
          hit refresh to see new orders. Renders nothing. */}
      <LiveRefresh projectId={ctx.project.id} />
      {/* Topbar — greeting + today chip */}
      <div className="mb-7 flex items-center justify-between gap-3">
        <div>
          <h1 className="font-display text-[22px] font-bold">
            مرحبًا، {ctx.project.name} ☕
          </h1>
          <p className="mt-0.5 text-[12.5px] text-[var(--color-text-secondary)]">
            {todayLabel}
          </p>
        </div>
        <div
          className="rounded-[var(--radius-md)] border border-[var(--color-border)] bg-[var(--color-surface)] px-4 py-2 font-mono text-[12.5px] tabular-nums text-[var(--color-text)]"
        >
          اليوم · {nowTime}
        </div>
      </div>

      <KpiCards
        todaySales={todaySales}
        currency={ctx.project.currency}
        salesDelta={salesDelta}
        peakHour={peakHour}
        todayOrders={todayOrders}
        ordersDelta={ordersDelta}
        pendingCount={pendingCount}
        occupiedCount={occupiedCount}
        totalActiveTables={totalActiveTables}
      />

      <ChecklistSection checklist={checklist} doneCount={doneCount} allDone={allDone} />

      {/* Grid 2 — hourly sales + latest orders table */}
      <section className="mb-8 grid gap-4 lg:grid-cols-[1.4fr_1fr]">
        <HourlySalesChart hourBuckets={hourBuckets} currency={ctx.project.currency} />
        <RecentOrdersTable
          recentOrders={rollup.recentOrders}
          currency={ctx.project.currency}
        />
      </section>

      {/* Last 7 days + top 3 */}
      <section className="mb-8 grid gap-6 lg:grid-cols-2">
        <WeeklySalesChart byDay7={byDay7} currency={ctx.project.currency} />
        <TopProducts top3={top3} currency={ctx.project.currency} />
      </section>
    </div>
  );
}
