'use client';

import { formatMoney } from '@/lib/utils';
import { BAHRAIN_TZ, STATUS_STEPS } from '@/lib/order-filters';
import {
  ORDER_STATUS_LABELS,
  ORDER_TYPE_LABELS,
  type OrderItemOption,
} from '@/lib/types';
import type { OrderRow } from '@/components/dashboard/orders/use-orders-feed';

/**
 * One order, as the merchant reads it: header, the read-only status stepper,
 * the lines and the note. Extracted verbatim from `orders-client.tsx`
 * (architecture review 2026-10-13, wave 4) — markup only.
 *
 * The stepper is display-only on purpose: status changes come from the kitchen
 * screen (`advance_order_status`), so this page never writes.
 */
export function OrderCard({ order, currency }: { order: OrderRow; currency: string }) {
  return (
    <article className="dashboard-card card">
      <div className="flex flex-wrap items-start justify-between gap-3 border-b border-[var(--color-border)] px-4 py-3">
        <div>
          <div className="flex flex-wrap items-center gap-2">
            <span className="text-sm font-bold tabular-nums" dir="ltr">
              order-{order.order_number}
            </span>
            <span className={`badge badge-${order.status}`}>{ORDER_STATUS_LABELS[order.status]}</span>
            <span className="text-xs text-[var(--color-text-muted)]">
              {ORDER_TYPE_LABELS[order.type]}
            </span>
          </div>
          <p className="mt-0.5 text-xs text-[var(--color-text-secondary)]">
            {order.tables ? `طاولة ${order.tables.number}` : 'بدون طاولة'}{' '}
            · {new Date(order.created_at).toLocaleString('ar-BH-u-nu-latn', { timeZone: BAHRAIN_TZ })}
          </p>
        </div>
        <p className="text-sm font-bold tabular-nums">
          {formatMoney(Number(order.total_amount), currency)}
        </p>
      </div>

      {/* Status stepper — ثابت (عرض فقط): يعكس تسلسل العملية الحقيقية */}
      {order.status !== 'cancelled' ? (
        <div className="px-4 py-2.5" dir="ltr">
          <div className="flex items-center gap-1">
            {STATUS_STEPS.map((step, i) => {
              const idx = STATUS_STEPS.indexOf(order.status);
              const done = i < idx;
              const active = i === idx;
              return (
                <div key={step} className="flex flex-1 items-center gap-1 last:flex-none">
                  <span
                    className={`h-2 w-2 shrink-0 rounded-full ${
                      done
                        ? 'bg-[var(--color-success)]'
                        : active
                          ? 'bg-[var(--color-primary)] ring-2 ring-[var(--color-primary-tint)]'
                          : 'bg-[var(--color-border)]'
                    }`}
                  />
                  {i < STATUS_STEPS.length - 1 && (
                    <span
                      className={`h-0.5 flex-1 rounded ${
                        i < idx ? 'bg-[var(--color-success)]' : 'bg-[var(--color-border)]'
                      }`}
                    />
                  )}
                </div>
              );
            })}
          </div>
          <p className="mt-1 text-caption text-[var(--color-text-muted)]" dir="rtl">
            {ORDER_STATUS_LABELS[order.status]}
          </p>
        </div>
      ) : (
        <p className="border-b border-[var(--color-border)] px-4 py-2 text-caption font-bold text-[var(--color-danger)]">
          {ORDER_STATUS_LABELS.cancelled}
        </p>
      )}

      {order.order_items && order.order_items.length > 0 && (
        <ul className="space-y-1 px-4 py-3 text-sm">
          {order.order_items.map((item) => (
            <li key={item.id} className="flex justify-between gap-2">
              <span>
                <strong>{item.quantity}×</strong> {item.product_name}
                {Array.isArray(item.addons) && item.addons.length > 0 && (
                  <span className="block text-xs text-[var(--color-text-muted)]">
                    {(item.addons as OrderItemOption[]).map((a) => a.name).join(' · ')}
                  </span>
                )}
                {item.notes && (
                  <span className="block text-xs text-[var(--color-text-muted)]">{item.notes}</span>
                )}
              </span>
              <span className="text-[var(--color-text-secondary)] shrink-0 tabular-nums">
                {formatMoney(Number(item.unit_price) * item.quantity, currency)}
              </span>
            </li>
          ))}
        </ul>
      )}
      {order.notes && (
        <p className="border-t border-[var(--color-border)] px-4 py-2 text-xs text-[var(--color-text-secondary)]">
          {order.notes}
        </p>
      )}
    </article>
  );
}
