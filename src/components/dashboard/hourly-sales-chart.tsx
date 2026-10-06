// D1: Hourly sales bar chart — extracted from dashboard/page.tsx.
// Pure CSS bars (no chart library — Karpathy: don't add a dependency the
// current charts don't need). aria-label carries the full data for SRs.
import { formatMoney } from '@/lib/utils';
import type { HourBucket } from '@/lib/dashboard-data';

export function HourlySalesChart({
  hourBuckets,
  currency,
}: {
  hourBuckets: HourBucket[];
  currency: string;
}) {
  const maxHourRevenue = Math.max(...hourBuckets.map((b) => b.revenue), 0.001);

  return (
    <div className="chart-container rounded-[var(--radius-lg)] border border-[var(--color-border)] bg-[var(--color-surface)] p-4">
      <h2 className="mb-3.5 flex items-center justify-between font-display text-[14.5px] font-bold">
        المبيعات بالساعة
        <span className="text-[11px] font-normal text-[var(--color-text-secondary)]">
          آخر 7 ساعات
        </span>
      </h2>
      {hourBuckets.every((b) => b.revenue === 0) ? (
        <p className="text-xs text-[var(--color-text-muted)]">
          ما فيه مبيعات اليوم — أول طلب يظهر هنا.
        </p>
      ) : (
        <div
          className="flex h-[140px] items-end gap-2.5"
          role="img"
          aria-label={`المبيعات بالساعة — ${hourBuckets.map((b) => `${b.label} ${formatMoney(b.revenue, currency)}`).join('، ')}`}
        >
          {hourBuckets.map((b) => (
            <div
              key={b.key}
              className="group relative flex flex-1 flex-col items-center"
              title={`${b.label} — ${formatMoney(b.revenue, currency)}`}
            >
              <div
                className="w-full transition-all group-hover:opacity-80"
                style={{
                  height: `${Math.max((b.revenue / maxHourRevenue) * 100, b.revenue > 0 ? 8 : 2)}%`,
                  background: 'linear-gradient(to top, var(--color-primary), var(--color-primary-tint-strong))',
                }}
              />
              <span className="absolute -bottom-5 text-[10px] text-[var(--color-text-secondary)]">
                {b.label}
              </span>
            </div>
          ))}
        </div>
      )}
    </div>
  );
}
