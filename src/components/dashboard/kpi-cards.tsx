// D1: KPI stat cards — extracted from dashboard/page.tsx. All four cards are
// links to their detail page (analytics / orders / kitchen / tables).
import Link from 'next/link';
import { formatMoney } from '@/lib/utils';
import type { HourBucket } from '@/lib/dashboard-data';

export function KpiCards({
  todaySales,
  currency,
  salesDelta,
  peakHour,
  todayOrders,
  ordersDelta,
  pendingCount,
  occupiedCount,
  totalActiveTables,
}: {
  todaySales: number;
  currency: string;
  salesDelta: number | null;
  peakHour: HourBucket | undefined;
  todayOrders: number | null;
  ordersDelta: number;
  pendingCount: number | null;
  occupiedCount: number;
  totalActiveTables: number;
}) {
  return (
    <div className="mb-7 grid grid-cols-1 gap-3.5 sm:grid-cols-2 xl:grid-cols-4">
      <Link
        href="/dashboard/analytics"
        className="block rounded-[var(--radius-lg)] border border-[var(--color-border)] bg-[var(--color-surface)] p-4 transition-colors hover:border-[var(--color-border-strong)]"
      >
        <p className="mb-2 text-[12px] text-[var(--color-text-secondary)]">إجمالي مبيعات اليوم</p>
        <p className="font-mono text-[26px] font-bold tabular-nums leading-none" dir="ltr">
          {formatMoney(todaySales, currency)}
        </p>
        {salesDelta !== null ? (
          <p className={`mt-1.5 text-[11.5px] font-semibold ${salesDelta >= 0 ? 'text-[var(--color-success)]' : 'text-[var(--color-danger)]'}`}>
            {salesDelta >= 0 ? '↑' : '↓'} {Math.abs(salesDelta)}٪ عن أمس
          </p>
        ) : (
          <p className="mt-1.5 text-[11.5px] text-[var(--color-text-muted)]">— لا مبيعات أمس</p>
        )}
        {peakHour && peakHour.revenue > 0 && (
          <p className="mt-1.5 text-[11.5px] text-[var(--color-text-secondary)]">
            ⏰ وقت الذروة: {peakHour.label} — {formatMoney(peakHour.revenue, currency)}
          </p>
        )}
      </Link>

      <Link
        href="/dashboard/orders"
        className="block rounded-[var(--radius-lg)] border border-[var(--color-border)] bg-[var(--color-surface)] p-4 transition-colors hover:border-[var(--color-border-strong)]"
      >
        <p className="mb-2 text-[12px] text-[var(--color-text-secondary)]">عدد الطلبات</p>
        <p className="font-mono text-[26px] font-bold tabular-nums leading-none" dir="ltr">
          {todayOrders ?? 0}
        </p>
        {ordersDelta !== 0 ? (
          <p className={`mt-1.5 text-[11.5px] font-semibold ${ordersDelta > 0 ? 'text-[var(--color-success)]' : 'text-[var(--color-danger)]'}`}>
            {ordersDelta > 0 ? '↑' : '↓'} {Math.abs(ordersDelta)} طلبات
          </p>
        ) : (
          <p className="mt-1.5 text-[11.5px] text-[var(--color-text-muted)]">— مثل أمس</p>
        )}
      </Link>

      <Link
        href="/dashboard/kitchen"
        className="block rounded-[var(--radius-lg)] border border-[var(--color-border)] bg-[var(--color-surface)] p-4 transition-colors hover:border-[var(--color-border-strong)]"
      >
        <p className="mb-2 text-[12px] text-[var(--color-text-secondary)]">قيد التنفيذ</p>
        <p className="font-mono text-[26px] font-bold tabular-nums leading-none" dir="ltr">
          {pendingCount ?? 0}
        </p>
        {(pendingCount ?? 0) > 0 ? (
          <span className="mt-1.5 inline-block text-[11.5px] font-semibold text-[var(--color-primary)]">
            شاشة المطبخ ←
          </span>
        ) : (
          <p className="mt-1.5 text-[11.5px] text-[var(--color-text-muted)]">— كل شيء جاهز</p>
        )}
      </Link>

      <Link
        href="/dashboard/tables"
        className="block rounded-[var(--radius-lg)] border border-[var(--color-border)] bg-[var(--color-surface)] p-4 transition-colors hover:border-[var(--color-border-strong)]"
      >
        <p className="mb-2 text-[12px] text-[var(--color-text-secondary)]">الطاولات النشطة</p>
        <p className="font-mono text-[26px] font-bold tabular-nums leading-none" dir="ltr">
          {occupiedCount}
          <span className="text-[16px] text-[var(--color-text-muted)]">/{totalActiveTables}</span>
        </p>
        <p className="mt-1.5 text-[11.5px] text-[var(--color-text-muted)]">
          {occupiedCount > 0 ? `${occupiedCount} مشغولة الآن` : '— كلها متاحة'}
        </p>
      </Link>
    </div>
  );
}
