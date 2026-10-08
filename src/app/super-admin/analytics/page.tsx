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

/** Asia/Bahrain helpers (Vercel runs UTC — never use server-local "today").
 *  Perf: the formatters are built ONCE here. They used to be constructed inside
 *  the 14-day trend loop (14× per request) and inside bahrainBounds (14× more). */
const bahrainDayFmt = new Intl.DateTimeFormat('en-CA', {
  timeZone: 'Asia/Bahrain',
  year: 'numeric',
  month: '2-digit',
  day: '2-digit',
});
const trendLabelFmt = new Intl.DateTimeFormat('ar', {
  numberingSystem: 'latn',
  timeZone: 'Asia/Bahrain',
  day: 'numeric',
  month: 'short',
});
const lastActiveFmt = new Intl.DateTimeFormat('ar', {
  numberingSystem: 'latn',
  timeZone: 'Asia/Bahrain',
  day: 'numeric',
  month: 'short',
  hour: '2-digit',
  minute: '2-digit',
});

/** Bahrain calendar-day key (YYYY-MM-DD) for an instant. */
function bahrainDayKey(d: Date): string {
  return bahrainDayFmt.format(d);
}

/** Bahrain day keys for the last `n` whole days, oldest → today (no DST in +03). */
function bahrainDaysBack(n: number): string[] {
  const out: string[] = [];
  const now = Date.now();
  for (let i = n - 1; i >= 0; i--) out.push(bahrainDayKey(new Date(now - i * 86400e3)));
  return out;
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
  // The live query is capped at 5000 rows. It used to truncate SILENTLY — the
  // headline totals would quietly under-report once the platform passed that
  // volume. Surface it instead (and see the rollup note at the page foot).
  const ordersCapped = orderRows.length >= 5000;

  // ---------- Aggregate (single pass) ----------
  // Perf: one loop builds the per-day buckets, the per-project rollup AND the
  // all-time totals. The previous version re-filtered the whole order set once
  // per trend day (14×N comparisons) and constructed an Intl formatter inside
  // that loop.
  const activeCount = projRows.filter((p) => p.is_active).length;

  const dayBuckets = new Map<string, { revenue: number; orders: number }>();
  const byProject = new Map<
    string,
    { revenue: number; orders: number; lastActive: string | null }
  >();
  let totalRevenue = 0;
  let totalOrders = 0;

  for (const o of orderRows) {
    if (o.status === 'cancelled') continue;
    const amount = Number(o.total_amount);
    totalRevenue += amount;
    totalOrders += 1;

    const key = bahrainDayKey(new Date(o.created_at));
    const day = dayBuckets.get(key) ?? { revenue: 0, orders: 0 };
    day.revenue += amount;
    day.orders += 1;
    dayBuckets.set(key, day);

    const agg = byProject.get(o.project_id) ?? { revenue: 0, orders: 0, lastActive: null as string | null };
    agg.revenue += amount;
    agg.orders += 1;
    if (!agg.lastActive || o.created_at > agg.lastActive) agg.lastActive = o.created_at;
    byProject.set(o.project_id, agg);
  }

  const sumDays = (keys: string[]) =>
    keys.reduce((s, k) => s + (dayBuckets.get(k)?.revenue ?? 0), 0);

  const revenueToday = dayBuckets.get(bahrainDayKey(new Date()))?.revenue ?? 0;
  const revenueWeek = sumDays(bahrainDaysBack(7)); // last 7 days incl today
  const revenueMonth = sumDays(bahrainDaysBack(30)); // last 30 days incl today

  // Trend: last 14 Bahrain days, oldest → today
  const trendDays = bahrainDaysBack(14).map((k) => ({
    label: trendLabelFmt.format(new Date(`${k}T00:00:00+03:00`)),
    revenue: dayBuckets.get(k)?.revenue ?? 0,
    orders: dayBuckets.get(k)?.orders ?? 0,
  }));
  const maxTrend = Math.max(1, ...trendDays.map((t) => t.revenue));

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

      {ordersCapped && (
        <div
          role="alert"
          className="mt-4 rounded-[var(--radius-md)] border border-[var(--color-warn)]/30 bg-[var(--color-warn-tint)] px-3 py-2 text-[12px] font-semibold text-[var(--color-warn)]"
        >
          تنبيه: وصل الاستعلام إلى سقف 5000 طلب — الأرقام أدناه ناقصة. مطلوب جدول تجميع (rollup) الآن.
        </div>
      )}
      <p className="mt-4 text-[11.5px] text-[var(--color-text-muted)]">
        قرار الأداء الموثق: استعلام مباشر محدود بـ5000 طلب لكل صفحة. بعد تجاوز هذا الحجم
        تُستبدل هذه الصفحة بجدول تجميع مجدول (rollup) دون إعادة كتابة — والتحذير أعلاه
        يظهر لحظة بلوغ السقف بدل الاقتطاع الصامت.
      </p>
    </div>
  );
}
