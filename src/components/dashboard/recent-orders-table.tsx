// D1: Recent orders table — extracted from dashboard/page.tsx.
import Link from 'next/link';
import { ShoppingBag } from 'lucide-react';
import { formatMoney } from '@/lib/utils';
import { EmptyState } from '@/components/ui/empty-state';
import { StatusChip } from '@/components/ui/status-chip';
import { tableLabel, type RecentOrder } from '@/lib/dashboard-data';

export function RecentOrdersTable({
  recentOrders,
  currency,
}: {
  recentOrders: RecentOrder[];
  currency: string;
}) {
  return (
    <div className="chart-container rounded-[var(--radius-lg)] border border-[var(--color-border)] bg-[var(--color-surface)] p-4">
      <h2 className="mb-3.5 flex items-center justify-between font-display text-[14.5px] font-bold">
        آخر الطلبات
        <Link
          href="/dashboard/orders"
          className="inline-flex min-h-[44px] items-center text-[11px] font-normal text-[var(--color-primary)]"
        >
          عرض الكل
        </Link>
      </h2>
      {!recentOrders?.length ? (
        <EmptyState
          icon={<ShoppingBag className="h-8 w-8" />}
          title="ما فيه طلبات حالياً"
          description="أول طلب بيظهر هنا مباشرة."
          action={
            <Link href="/dashboard/pos" className="btn btn-primary">
              افتح POS
            </Link>
          }
        />
      ) : (
        <table className="w-full border-collapse text-[13px]">
          {/* FIX-T-004: رأس ثابت عند التمرير في الجداول الطويلة */}
          <thead className="sticky top-0 z-[var(--z-sticky)]">
            <tr>
              <th className="border-b border-[var(--color-border)] bg-[var(--color-surface-sunken)] p-1.5 text-start text-[11.5px] font-medium text-[var(--color-text-secondary)]">#</th>
              <th className="border-b border-[var(--color-border)] bg-[var(--color-surface-sunken)] p-1.5 text-start text-[11.5px] font-medium text-[var(--color-text-secondary)]">الطاولة</th>
              <th className="border-b border-[var(--color-border)] bg-[var(--color-surface-sunken)] p-1.5 text-start text-[11.5px] font-medium text-[var(--color-text-secondary)]">المبلغ</th>
              <th className="border-b border-[var(--color-border)] bg-[var(--color-surface-sunken)] p-1.5 text-start text-[11.5px] font-medium text-[var(--color-text-secondary)]">الحالة</th>
            </tr>
          </thead>
          <tbody>
            {recentOrders.map((o) => (
              <tr key={o.id} className="h-11">
                <td className="border-b border-[var(--color-border)] p-2 font-mono text-[12px] tabular-nums" dir="ltr">
                  #{String(o.order_number).padStart(3, '0')}
                </td>
                <td className="border-b border-[var(--color-border)] p-2 font-mono text-[12px] tabular-nums">
                  {tableLabel(o)}
                </td>
                <td className="border-b border-[var(--color-border)] p-2 font-mono text-[12px] font-bold tabular-nums">
                  {formatMoney(Number(o.total_amount), currency)}
                </td>
                <td className="border-b border-[var(--color-border)] p-2">
                  <StatusChip status={o.status} />
                </td>
              </tr>
            ))}
          </tbody>
        </table>
      )}
    </div>
  );
}
