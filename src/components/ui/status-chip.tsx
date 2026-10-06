'use client';

import { cn } from '@/lib/utils';
import { ORDER_STATUS_LABELS, type OrderStatus } from '@/lib/types';

/**
 * StatusChip — single source of truth for order-status labels & pill styling.
 *
 * Arabic labels come from `ORDER_STATUS_LABELS` (lib/types.ts), the SAME map
 * orders-client uses, so every screen spells a status identically.
 *
 * Color mapping (Enterprise §6.3 pill tones):
 *   pending   → warn (جديد)
 *   preparing → info (قيد التحضير)
 *   ready     → success (جاهز)
 *   delivered → secondary/sunken (تم التسليم)
 *   cancelled → danger (ملغي)
 *
 * KDS tickets intentionally do NOT use this chip — they render their own
 * status-driven border + urgent timer (تذاكر المطبخ). They only import the
 * LABELS, keeping the two surfaces' color semantics distinct.
 */
export function StatusChip({
  status,
  className,
}: {
  status: string;
  className?: string;
}) {
  const base =
    'inline-block rounded-full px-2.5 py-0.5 text-xs font-semibold whitespace-nowrap';

  const tones: Record<string, string> = {
    pending: 'bg-[var(--color-warn-tint)] text-[var(--color-warn)]',
    preparing: 'bg-[var(--color-info-tint)] text-[var(--color-info)]',
    ready: 'bg-[var(--color-success-tint)] text-[var(--color-success)]',
    // audit T1 #4: text-muted on sunken measured 4.34:1 (the audit's own number) - under the
    // 4.5:1 bar for 12px text. text-secondary on the same surface is 4.68:1.
    delivered: 'bg-[var(--color-surface-sunken)] text-[var(--color-text-secondary)]',
    cancelled: 'bg-[var(--color-danger-tint)] text-[var(--color-danger)]',
  };

  return (
    <span className={cn(base, tones[status] ?? tones.cancelled, className)}>
      {ORDER_STATUS_LABELS[status as OrderStatus] ?? 'ملغي'}
    </span>
  );
}