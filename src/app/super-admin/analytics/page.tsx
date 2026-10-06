import Link from 'next/link';
import { createAdminClient } from '@/lib/supabase/admin';
import { requireSuperAdmin } from '@/lib/super-admin';

/**
 * Super-admin — platform-wide analytics (Phase B).
 * Read-only (service_role) — no tenant data mutation. Gated identically to
 * Phase A (requireSuperAdmin on every request).
 *
 * PERFORMANCE NOTE (documented decision): at 30 projects / ~13 orders a
 * direct query is fine. If project count grows past ~hundreds of projects or
 * order volume into the thousands, this page needs a scheduled rollup table
 * (or materialized view) — the aggregation below is intentionally plain so
 * the migration path is a drop-in replacement, not a rewrite.
 */
export const dynamic = 'force-dynamic';

type OrderRow = {
  id: string;
  project_id: string;
  status: string;
  total_amount: number;
  created_at: string;
};

type ProjectRow = {
  id: string;
  name: string;
  slug: string;
  is_active: boolean;
};

/** Asia/Bahrain day bounds (Vercel runs UTC — never use server-local "today").
 *  daysAgoStart..daysAgoEndInclusive are whole Bahrain calendar days back from
 *  today (0 = today). Returns an ISO [start, end) window covering them. */
function bahrainBounds(daysAgoStart: number, daysAgoEndInclusive: number): { start: string; end: string } {
  const now = new Date();
  // Convert to Bahrain wall-clock
  const parts = new Intl.DateTimeFormat('en-CA', {
    timeZone: 'Asia/Bahrain',
    year: 'numeric',
    month: '2-digit',
    day: '2-digit',
  }).formatToParts(now);
  const y = Number(parts.find((p) => p.type === 'year')!.value);
  const m = Number(parts.find((p) => p.type === 'month')!.value);
  const d = Number(parts.find((p) => p.type === 'day')!.value);
  const todayStart = new Date(Date.UTC(y, m - 1, d)); // midnight Bahrain = this UTC instant
  const start = new Date(todayStart.getTime() - daysAgoStart * 86400e3);
  const end = new Date(todayStart.getTime() - daysAgoEndInclusive * 86400e3 + 86400e3);
  return { start: start.toISOString(), end: end.toISOString() };
}

const moneyFmt = new Intl.NumberFormat('ar', { numberingSystem: 'latn', maximumFractionDigits: 3 });
const numFmt = new Intl.NumberFormat('ar', { numberingSystem: 'latn' });

export default async function SuperAdminAnalyticsPage({
  searchParams,
}: {
  searchParams: Promise<{ sort?: string; dir?: string }>;
}) {
  await requireSuperAdmin();
  const sp = await searchParams;
  const sortBy = (['revenue', 'orders', 'aov', 'lastActive'] as const).includes(sp.sort as never)
    ? (sp.sort as 'revenue' | 'orders' | 'aov' | 'lastActive')
    : 'revenue';
  const dir = sp.dir === 'asc' ? 'asc' : 'desc';

  const admin = createAdminClient();

  const [{ data: projects }, { data: orders }] = await Promise.all([
    admin.from('projects').select('id, name, slug, is_active').order('created_at', { ascending: false }).limit(1000),
    admin
      .from('orders')
      .select('id, project_id, status, total_amount, created_at')
      .is('service_type', null) // real orders only — waiter/bill are zero-amount signals
      .limit(5000),
  ]);

  const projRows = (projects ?? []) as unknown as ProjectRow[];
  const orderRows = (orders ?? []) as unknown as OrderRow[];

  // ---------- Aggregate ----------
  const activeCount = projRows.filter((p) => p.is_active).length;
  const completedOrders = orderRows.filter((o) => o.status !== 'cancelled');
  const totalRevenue = completedOrders.reduce((s, o) => s + Number(o.total_amount), 0);
  const totalOrders = completedOrders.length;

  const today = bahrainBounds(0, 0);
  const week = bahrainBounds(6, 0); // last 7 days incl today
  const month = bahrainBounds(29, 0); // last 30 days incl today

  const sumBetween = (rows: OrderRow[], start: string, end: string) =>
    rows
      .filter((o) => o.status !== 'cancelled' && o.created_at >= start && o.created_at < end)
      .reduce((s, o) => s + Number(o.total_amount), 0);

  const revenueToday = sumBetween(completedOrders, today.start, today.end);
  const revenueWeek = sumBetween(completedOrders, week.start, week.end);
  const revenueMonth = sumBetween(completedOrders, month.start, month.end);

  // Trend: last 14 days by Bahrain date
  const trendDays: { label: string; revenue: number; orders: number }[] = [];
  for (let i = 13; i >= 0; i--) {
    const b = bahrainBounds(i, i);
    const dayOrders = completedOrders.filter((o) => o.created_at >= b.start && o.created_at < b.end);
    const label = new Intl.DateTimeFormat('ar', {
      numberingSystem: 'latn',
      timeZone: 'Asia/Bahrain',
      day: 'numeric',
      month: 'short',
    }).format(new Date(b.start));
    trendDays.push({
      label,
      revenue: dayOrders.reduce((s, o) => s + Number(o.total_amount), 0),
      orders: dayOrders.length,
    });
  }
  const maxTrend = Math.max(1, ...trendDays.map((t) => t.revenue));

  // ---------- Per-project comparison ----------
  const byProject = new Map<
    string,
    { revenue: number; orders: number; lastActive: string | null }
  >();
  for (const o of completedOrders) {
    const agg = byProject.get(o.project_id) ?? { revenue: 0, orders: 0, lastActive: null as string | null };
    agg.revenue += Number(o.total_amount);
    agg.orders += 1;
    if (!agg.lastActive || o.created_at > agg.lastActive) agg.lastActive = o.created_at;
    byProject.set(o.project_id, agg);
  }

  const rows = projRows.map((p) => {
    const agg = byProject.get(p.id) ?? { revenue: 0, orders: 0, lastActive: null };
    return {
      ...p,
      ...agg,
      aov: agg.orders > 0 ? agg.revenue / agg.orders : 0,
    };
  });

  rows.sort((a, b) => {
    const va = a[sortBy] ?? 0;
    const vb = b[sortBy] ?? 0;
    const cmp = typeof va === 'string' ? String(va).localeCompare(String(vb)) : (va as number) - (vb as number);
    return dir === 'asc' ? cmp : -cmp;
  });

  const lastActiveFmt = new Intl.DateTimeFormat('ar', {
      numberingSystem: 'latn',
    timeZone: 'Asia/Bahrain',
    day: 'numeric',
    month: 'short',
    hour: '2-digit',
    minute: '2-digit',
  });

  const sortHref = (key: 'revenue' | 'orders' | 'aov' | 'lastActive') =>
    `/super-admin/analytics?sort=${key}&dir=${sortBy === key && dir === 'desc' ? 'asc' : 'desc'}`;

  return (
    <div>
      <div className="mb-6 flex flex-wrap items-center justify-between gap-3">
        <div>
          <h1 className="text-xl font-bold">التحليلات</h1>
          <p className="text-xs text-[var(--color-text-secondary)]">
            إيرادات وطلبات كل المنصة — للطلبات الفعلية فقط (بدون طلبات الخدمة)
          </p>
        </div>
        <Link href="/super-admin/subscriptions" className="btn btn-ghost btn-sm">
          ← الاشتراكات
        </Link>
      </div>

      {/* Aggregate cards */}
      <div className="mb-6 grid grid-cols-2 gap-3 md:grid-cols-4">
        <div className="card card-body">
          <div className="text-xs font-semibold text-[var(--color-text-secondary)]">إيرادات اليوم</div>
          <div className="mt-1 text-lg font-bold">{moneyFmt.format(revenueToday)}</div>
        </div>
        <div className="card card-body">
          <div className="text-xs font-semibold text-[var(--color-text-secondary)]">آخر 7 أيام</div>
          <div className="mt-1 text-lg font-bold">{moneyFmt.format(revenueWeek)}</div>
        </div>
        <div className="card card-body">
          <div className="text-xs font-semibold text-[var(--color-text-secondary)]">آخر 30 يوم</div>
          <div className="mt-1 text-lg font-bold">{moneyFmt.format(revenueMonth)}</div>
        </div>
        <div className="card card-body">
          <div className="text-xs font-semibold text-[var(--color-text-secondary)]">مشاريع نشطة</div>
          <div className="mt-1 text-lg font-bold">{numFmt.format(activeCount)} / {numFmt.format(projRows.length)}</div>
        </div>
      </div>

      {/* Trend chart (simple bars) */}
      <div className="card card-body mb-6">
        <h2 className="mb-3 text-sm font-bold">آخر 14 يوم — الإيرادات اليومية</h2>
        <div className="flex h-32 items-end gap-1">
          {trendDays.map((t) => (
            <div key={t.label} className="group flex flex-1 flex-col items-center gap-1">
              <div
                className="w-full rounded-t bg-[var(--color-primary)]/70 transition-colors group-hover:bg-[var(--color-primary)]"
                style={{ height: `${Math.max(4, (t.revenue / maxTrend) * 100)}%` }}
                title={`${t.label}: ${moneyFmt.format(t.revenue)} (${t.orders} طلب)`}
              />
              <span className="text-[11.5px] text-[var(--color-text-muted)]">{t.label}</span>
            </div>
          ))}
        </div>
        <p className="mt-2 text-[11.5px] text-[var(--color-text-muted)]">
          الإجمالي الكلي: {moneyFmt.format(totalRevenue)} · {numFmt.format(totalOrders)} طلب مكتمل
        </p>
      </div>

      {/* Per-project table */}
      <div className="card overflow-x-auto">
        <table className="w-full min-w-[680px] text-start text-sm">
          <thead>
            <tr className="border-b border-[var(--color-border)] text-xs text-[var(--color-text-secondary)]">
              <th className="px-3 py-2.5 font-semibold">المتجر</th>
              <th className="px-3 py-2.5 font-semibold">
                <a href={sortHref('revenue')} className="hover:text-[var(--color-text)]">
                  الإيرادات {sortBy === 'revenue' && (dir === 'desc' ? '↓' : '↑')}
                </a>
              </th>
              <th className="px-3 py-2.5 font-semibold">
                <a href={sortHref('orders')} className="hover:text-[var(--color-text)]">
                  الطلبات {sortBy === 'orders' && (dir === 'desc' ? '↓' : '↑')}
                </a>
              </th>
              <th className="px-3 py-2.5 font-semibold">
                <a href={sortHref('aov')} className="hover:text-[var(--color-text)]">
                  متوسط الطلب {sortBy === 'aov' && (dir === 'desc' ? '↓' : '↑')}
                </a>
              </th>
              <th className="px-3 py-2.5 font-semibold">
                <a href={sortHref('lastActive')} className="hover:text-[var(--color-text)]">
                  آخر نشاط {sortBy === 'lastActive' && (dir === 'desc' ? '↓' : '↑')}
                </a>
              </th>
            </tr>
          </thead>
          <tbody>
            {rows.map((r) => (
              <tr key={r.id} className="border-b border-[var(--color-border)]/60 last:border-0">
                <td className="px-3 py-2.5">
                  <div className="font-bold">{r.name}</div>
                  <div className="flex items-center gap-1.5 text-[11.5px] text-[var(--color-text-muted)]">
                    <span dir="ltr">{r.slug}</span>
                    {!r.is_active && (
                      <span className="rounded-full bg-[var(--color-danger-tint)] px-1.5 py-px text-[11.5px] font-bold text-[var(--color-danger)]">
                        موقوف
                      </span>
                    )}
                  </div>
                </td>
                <td className="px-3 py-2.5 font-bold">{moneyFmt.format(r.revenue)}</td>
                <td className="px-3 py-2.5">{numFmt.format(r.orders)}</td>
                <td className="px-3 py-2.5">{moneyFmt.format(r.aov)}</td>
                <td className="px-3 py-2.5 text-[var(--color-text-secondary)]">
                  {r.lastActive ? lastActiveFmt.format(new Date(r.lastActive)) : '—'}
                </td>
              </tr>
            ))}
          </tbody>
        </table>
      </div>

      <p className="mt-4 text-[11.5px] text-[var(--color-text-muted)]">
        قرار الأداء الموثق: عند ~30 مشروعًا الاستعلام المباشر كافٍ. عند نمو الحجم لمئات
        المشاريع/آلاف الطلبات، تُستبدل هذه الصفحة بجدول تجميع مجدول (rollup) دون إعادة كتابة.
      </p>
    </div>
  );
}
