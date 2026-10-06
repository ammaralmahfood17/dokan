// D1: Weekly (7-day) sales bar chart — extracted from dashboard/page.tsx.
import { TrendingUp } from 'lucide-react';
import { formatMoney } from '@/lib/utils';
import type { DayBucket } from '@/lib/dashboard-data';

export function WeeklySalesChart({
  byDay7,
  currency,
}: {
  byDay7: DayBucket[];
  currency: string;
}) {
  const maxDayRevenue = Math.max(...byDay7.map((d) => d.revenue), 0.001);

  return (
    <div className="chart-container card card-body">
      <div className="mb-4 flex items-center justify-between">
        <h2 className="font-display text-[14.5px] font-bold">مبيعات آخر 7 أيام</h2>
        <TrendingUp className="h-4 w-4 text-[var(--color-text-muted)]" />
      </div>
      {byDay7.every((d) => d.revenue === 0) ? (
        <p className="text-xs text-[var(--color-text-muted)]">
          ما فيه مبيعات هالأسبوع — أول طلب يظهر هنا.
        </p>
      ) : (
        <div
          className="flex h-28 items-end gap-1.5"
          dir="ltr"
          role="img"
          aria-label={`مبيعات آخر 7 أيام — ${byDay7.map((d) => `${d.label} ${formatMoney(d.revenue, currency)}`).join('، ')}`}
        >
          {byDay7.map((d) => (
            <div
              key={d.key}
              className="group relative flex flex-1 flex-col items-center gap-1"
              title={`${d.label} — ${formatMoney(d.revenue, currency)}`}
            >
              <div
                className="w-full rounded-t-[4px] bg-[var(--color-primary)] transition-all group-hover:opacity-80"
                style={{
                  height: `${Math.max((d.revenue / maxDayRevenue) * 100, d.revenue > 0 ? 4 : 2)}%`,
                }}
              />
              <span className="text-[11.5px] text-[var(--color-text-secondary)]">
                {d.label}
              </span>
            </div>
          ))}
        </div>
      )}
    </div>
  );
}
