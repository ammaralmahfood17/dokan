'use client';

// FIX-C-003: Order-success screen — extracted from menu-client.tsx.
// UX-U1: شريط حالة الطلب الحي — polling خفيف (12s) على /api/public/order-status
// يعرض تقدم الطلب (قيد الانتظار → قيد التحضير → جاهز) مع اهتزاز عند الجاهزية.
import { Bell, Check, Copy, FileText, Clock } from 'lucide-react';
import { formatMoney } from '@/lib/utils';
import { Button } from '@/components/ui/button';
import { useEffect, useRef, useState } from 'react';

type OrderStatus = 'pending' | 'preparing' | 'ready' | 'delivered' | 'cancelled';

const STEPS: { key: OrderStatus; label: string }[] = [
  { key: 'pending', label: 'قيد الانتظار' },
  { key: 'preparing', label: 'قيد التحضير' },
  { key: 'ready', label: 'جاهز' },
];

function stepIndex(status: OrderStatus): number {
  switch (status) {
    case 'pending': return 0;
    case 'preparing': return 1;
    case 'ready':
    case 'delivered': return 2;
    default: return -1; // cancelled
  }
}

export function OrderSuccessState({
  orderNumber,
  orderId,
  projectSlug,
  totalAmount,
  currency,
  busyAction,
  onCallService,
  onOrderMore,
  canReorder,
  onReorder,
}: {
  orderNumber: number;
  orderId?: string;
  projectSlug?: string;
  totalAmount: number;
  currency: string;
  busyAction: 'waiter' | 'bill' | null;
  onCallService: (kind: 'waiter' | 'bill') => void;
  onOrderMore: () => void;
  /** UX-6: «كرر الطلب» — restore the same lines into the cart. */
  canReorder?: boolean;
  onReorder?: () => void;
}) {
  const [status, setStatus] = useState<OrderStatus | null>(null);
  const [lost, setLost] = useState(false);
  const [copied, setCopied] = useState(false);
  const notifiedRef = useRef(false);

  // UX-6: نسخ رقم الطلب — للرجوع له عند سؤال الموظف
  async function copyOrderNumber() {
    try {
      await navigator.clipboard.writeText(String(orderNumber));
      setCopied(true);
      setTimeout(() => setCopied(false), 2000);
    } catch {
      // clipboard محجوب (سياق غير آمن) — الرقم ظاهر للنسخ اليدوي أصلاً
    }
  }

  // UX-U1: شريط حالة الطلب الحي.
  // A staff status change must reach the customer FAST — the old flat 12s poll
  // left them reading «قيد الانتظار» for up to twelve seconds after the kitchen
  // had already started the order (owner report 2026-10-06). The cadence is now
  // adaptive: 3s while the wait is short (the window where the customer is
  // actually watching the screen), backing off to 10s once the order has been
  // sitting a while, plus an immediate re-check whenever the tab returns to the
  // foreground — a customer who switched away comes back to a fresh status
  // instead of waiting out the next tick.
  useEffect(() => {
    if (!orderId || !projectSlug) return;
    let stopped = false;
    let timer: ReturnType<typeof setTimeout> | null = null;
    let attempts = 0;

    /** Fast window: ~2 minutes at 3s, then a slower watch for ~10 more minutes. */
    const FAST_MS = 3000;
    const SLOW_MS = 10000;
    const FAST_ATTEMPTS = 40;
    const MAX_ATTEMPTS = 100;

    const schedule = () => {
      if (stopped) return;
      if (attempts >= MAX_ATTEMPTS) {
        stopped = true;
        return;
      }
      timer = setTimeout(check, attempts < FAST_ATTEMPTS ? FAST_MS : SLOW_MS);
    };

    const check = async () => {
      try {
        const res = await fetch(
          `/api/public/order-status?orderId=${encodeURIComponent(orderId)}&projectSlug=${encodeURIComponent(projectSlug)}`
        );
        if (stopped) return;
        if (!res.ok) {
          setLost(true);
          attempts += 1;
          schedule();
          return;
        }
        const data = (await res.json()) as { status: OrderStatus };
        if (stopped) return;
        setStatus(data.status);
        setLost(false);

        const idx = stepIndex(data.status);
        if (idx >= 2) {
          // جاهز/تم التسليم — تنبيه المستخدم مرة واحدة فقط
          if (!notifiedRef.current) {
            notifiedRef.current = true;
            if (typeof navigator !== 'undefined' && 'vibrate' in navigator) {
              try { navigator.vibrate([200, 100, 200]); } catch { /* ignore */ }
            }
          }
          stopped = true;
          return;
        }
        attempts += 1;
        schedule();
      } catch {
        // شبكة عابرة — المحاولة التالية تلتقطها
        attempts += 1;
        schedule();
      }
    };

    // Coming back to the tab must not mean waiting up to 10s for the next tick.
    const onVisible = () => {
      if (document.visibilityState === 'visible' && !stopped) {
        if (timer) clearTimeout(timer);
        void check();
      }
    };
    document.addEventListener('visibilitychange', onVisible);

    void check();
    return () => {
      stopped = true;
      if (timer) clearTimeout(timer);
      document.removeEventListener('visibilitychange', onVisible);
    };
  }, [orderId, projectSlug]);

  const idx = status ? stepIndex(status) : 0;
  const cancelled = status === 'cancelled';

  return (
    <div className="flex min-h-dvh flex-col items-center justify-center bg-[var(--color-bg)] px-6 text-center page-enter">
      <div
        className={`mb-5 flex h-16 w-16 items-center justify-center rounded-full text-white ${cancelled ? 'bg-[var(--color-danger)]' : ''}`}
        style={cancelled ? undefined : { background: 'var(--color-primary)' }}
      >
        {cancelled ? <Bell className="h-8 w-8" /> : <Check className="h-8 w-8" />}
      </div>
      <h1 className="text-xl font-bold">{cancelled ? 'تم إلغاء الطلب' : 'تم استلام طلبك'}</h1>
      <p className="mt-1 text-sm text-[var(--color-text-secondary)]">
        رقم الطلب{' '}
        <span dir="ltr" className="font-bold">
          order-{orderNumber}
        </span>{' '}
        <button
          type="button"
          onClick={copyOrderNumber}
          aria-label="نسخ رقم الطلب"
          className="inline-flex h-11 w-11 -translate-y-0.5 items-center justify-center rounded-full text-[var(--color-text-secondary)] transition-colors hover:bg-[var(--color-surface-sunken)]"
        >
          {copied ? <Check className="h-4 w-4 text-[var(--color-primary)]" /> : <Copy className="h-4 w-4" />}
        </button>
      </p>
      <p className="mt-2 text-lg font-bold">{formatMoney(totalAmount, currency)}</p>

      {/* UX-U1: شريط حالة الطلب الحي */}
      {orderId && projectSlug && !cancelled && (
        <div className="mt-6 w-full max-w-sm rounded-[var(--radius-md)] border border-[var(--color-border)] bg-[var(--color-surface)] p-4">
          <div className="flex items-center justify-center gap-1">
            {STEPS.map((s, i) => {
              const active = i === idx;
              const done = i < idx;
              return (
                <div key={s.key} className="flex flex-1 flex-col items-center gap-1.5">
                  <div
                    className={`flex h-7 w-7 items-center justify-center rounded-full border-2 text-[11.5px] font-bold transition-colors ${
                      done
                        ? 'border-[var(--color-primary)] bg-[var(--color-primary)] text-white'
                        : active
                          ? 'border-[var(--color-primary)] bg-[var(--color-primary-tint)] text-[var(--color-primary)]'
                          : 'border-[var(--color-border)] text-[var(--color-text-muted)]'
                    }`}
                  >
                    {done ? <Check className="h-3.5 w-3.5" /> : i + 1}
                  </div>
                  <span className={`text-[11.5px] font-semibold ${active ? 'text-[var(--color-text)]' : 'text-[var(--color-text-muted)]'}`}>
                    {s.label}
                  </span>
                </div>
              );
            })}
          </div>
          <div className="mt-3 flex items-center justify-center gap-1.5 text-[11.5px] text-[var(--color-text-secondary)]">
            <Clock className="h-3.5 w-3.5" />
            {lost
              ? 'تعذّر تحديث الحالة — سنخبرك عند الجاهزية'
              : status === 'ready' || status === 'delivered'
                ? 'طلبك جاهز 🎉'
                : status === 'preparing'
                  ? 'طلبك قيد التحضير — يتم تحديث الحالة تلقائيًا'
                  : 'طلبك قيد الانتظار — يتم تحديث الحالة تلقائيًا'}
          </div>
        </div>
      )}

      <p className="mt-4 text-xs text-[var(--color-text-muted)]">
        يمكنك طلب الموظف أو الفاتورة من الأزرار أدناه
      </p>

      <div className="mt-6 flex w-full max-w-xs flex-col gap-3">
        <button
          type="button"
          disabled={busyAction !== null}
          onClick={() => onCallService('waiter')}
          className="min-h-[48px] flex w-full items-center justify-center gap-2 rounded-[var(--radius-md)] border border-[var(--color-border)] bg-[var(--color-surface)] px-4 text-sm font-bold transition-colors hover:bg-[var(--color-bg)] disabled:opacity-50"
        >
          <Bell className="h-4 w-4" />
          {busyAction === 'waiter' ? 'جاري…' : 'طلب موظف'}
        </button>
        <button
          type="button"
          disabled={busyAction !== null}
          onClick={() => onCallService('bill')}
          className="min-h-[48px] flex w-full items-center justify-center gap-2 rounded-[var(--radius-md)] border border-[var(--color-border)] bg-[var(--color-surface)] px-4 text-sm font-bold transition-colors hover:bg-[var(--color-bg)] disabled:opacity-50"
        >
          <FileText className="h-4 w-4" />
          {busyAction === 'bill' ? 'جاري…' : 'طلب الفاتورة'}
        </button>
      </div>

      <div className="mt-6 flex w-full max-w-xs flex-col gap-3">
        <Button variant="secondary" onClick={onOrderMore}>
          طلب المزيد
        </Button>
        {canReorder && onReorder && (
          <Button variant="ghost" onClick={onReorder}>
            كرر الطلب (نفس الأصناف)
          </Button>
        )}
      </div>
    </div>
  );
}
