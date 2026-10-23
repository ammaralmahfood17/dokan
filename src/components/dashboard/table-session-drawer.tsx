'use client';

import { useCallback, useEffect, useState } from 'react';
import { Receipt, X } from 'lucide-react';
import { Button } from '@/components/ui/button';
import { StatusChip } from '@/components/ui/status-chip';
import { createClient } from '@/lib/supabase/client';
import { formatMoney } from '@/lib/utils';
import { minutesSince, occupiedLabel, tableState, OCCUPANCY_LABEL } from '@/lib/floor-plan';
import type { OrderStatus, TableBoardRow } from '@/lib/types';
import { toast } from 'sonner';

type SessionOrder = {
  id: string;
  order_number: number;
  status: OrderStatus;
  total_amount: number;
  paid_at: string | null;
  created_at: string;
};

/**
 * «لوحة الجلسة» — what a staff member opens when they tap a table.
 *
 * One screen, three answers: which orders make up this seating, how much of it
 * is paid, and the two actions that end it (collect / close). The totals shown
 * are the ones `table_board()` computed on the server; the list is fetched here
 * only to name the orders. Money is never summed in JS for a decision.
 *
 * Closing is the ONLY way a table becomes free (owner decision 2026-10-23).
 * With active orders the modal demands a reason — the RPC refuses a forced
 * close without one, so this UI mirrors a database rule rather than inventing
 * a softer one.
 */
export function TableSessionDrawer({
  row,
  currency,
  onClose,
  onChanged,
}: {
  row: TableBoardRow;
  currency: string;
  onClose: () => void;
  onChanged: () => void;
}) {
  const [orders, setOrders] = useState<SessionOrder[]>([]);
  const [loading, setLoading] = useState(Boolean(row.session_id));
  const [busy, setBusy] = useState(false);
  const [closing, setClosing] = useState(false);
  const [reason, setReason] = useState('');
  const [reasonError, setReasonError] = useState('');
  const [now, setNow] = useState<number | null>(null);

  const state = tableState(row);

  const load = useCallback(async () => {
    if (!row.session_id) {
      setOrders([]);
      setLoading(false);
      return;
    }
    const supabase = createClient();
    const { data, error } = await supabase
      .from('orders')
      .select('id, order_number, status, total_amount, paid_at, created_at')
      .eq('session_id', row.session_id)
      .is('service_type', null)
      .order('created_at');
    if (error) {
      toast.error('ما قدرنا نقرأ طلبات الطاولة');
    }
    setOrders((data ?? []) as SessionOrder[]);
    setLoading(false);
  }, [row.session_id]);

  useEffect(() => {
    // Deferred one tick: a synchronous setState inside an effect is the
    // cascading render `react-hooks/set-state-in-effect` rejects, and the
    // orders are a network read anyway.
    const id = setTimeout(() => void load(), 0);
    return () => clearTimeout(id);
  }, [load]);

  // The duration chip must not be computed during render: the server clock and
  // the browser's differ (React #418), so it fills in after mount.
  useEffect(() => {
    const id = setInterval(() => setNow(Date.now()), 60_000);
    const first = setTimeout(() => setNow(Date.now()), 0);
    return () => {
      clearInterval(id);
      clearTimeout(first);
    };
  }, []);

  async function collect() {
    if (!row.session_id) return;
    setBusy(true);
    const supabase = createClient();
    const { data, error } = await supabase.rpc('collect_table_session', {
      p_session_id: row.session_id,
    });
    setBusy(false);
    if (error) {
      toast.error(error.message.includes('NOT_AUTHORIZED') ? 'ما عندك صلاحية' : 'فشل التحصيل');
      return;
    }
    const marked = Number((data as { marked?: number } | null)?.marked ?? 0);
    toast.success(marked > 0 ? `تم تحصيل ${marked} طلب` : 'كل الطلبات محصّلة');
    await load();
    onChanged();
  }

  /**
   * Collect ONE order. The session total is derived from rows, so this is also
   * how a customer pays their own order in cash without settling the table.
   */
  async function payOrder(orderId: string) {
    setBusy(true);
    const supabase = createClient();
    const { data, error } = await supabase.rpc('mark_order_paid', { p_order_id: orderId });
    setBusy(false);
    if (error) {
      toast.error(error.message.includes('NOT_AUTHORIZED') ? 'ما عندك صلاحية' : 'فشل تحصيل الطلب');
      return;
    }
    const already = Boolean((data as { already_paid?: boolean } | null)?.already_paid);
    toast.success(already ? 'الطلب مدفوع أصلًا' : 'تم تحصيل الطلب');
    await load();
    onChanged();
  }

  async function submitClose(force: boolean) {
    if (!row.session_id) return;
    if (force && reason.trim().length < 3) {
      setReasonError('اكتب سببًا واضحًا (3 أحرف على الأقل)');
      return;
    }
    setBusy(true);
    const supabase = createClient();
    const { error } = await supabase.rpc('close_table_session', {
      p_session_id: row.session_id,
      p_reason: reason.trim() || null,
      p_force: force,
    });
    setBusy(false);

    if (error) {
      if (error.message.includes('REASON_REQUIRED')) {
        setReasonError('السبب مطلوب عند وجود طلبات لم تُسلَّم');
        return;
      }
      if (error.message.includes('NOT_AUTHORIZED')) {
        toast.error('ما عندك صلاحية إغلاق الطاولة');
        return;
      }
      toast.error('فشل إغلاق الطاولة');
      return;
    }

    toast.success(`طاولة ${row.number} صارت متاحة`);
    onChanged();
    onClose();
  }

  const unpaid = row.unpaid_amount;
  const hasActive = row.active_orders > 0;

  return (
    <div
      className="fixed inset-0 z-[var(--z-modal)] flex items-end justify-center bg-black/40 sm:items-center sm:p-4"
      role="dialog"
      aria-modal="true"
      aria-labelledby="session-title"
      onClick={(e) => {
        if (e.target === e.currentTarget) onClose();
      }}
      onKeyDown={(e) => {
        if (e.key === 'Escape') onClose();
      }}
    >
      <div className="animate-slide-up flex max-h-dvh w-full flex-col overflow-hidden rounded-t-[14px] bg-[var(--color-surface)] pb-safe-bottom shadow-float sm:max-h-[85vh] sm:max-w-lg sm:rounded-[14px] sm:pb-0">
        <header className="flex items-start justify-between gap-3 border-b border-[var(--color-border)] px-4 py-3">
          <div>
            <h2 id="session-title" className="text-h2">
              طاولة {String(row.number).padStart(2, '0')}
              {row.zone ? <span className="text-caption font-normal text-[var(--color-text-secondary)]"> · {row.zone}</span> : null}
            </h2>
            <p className="mt-0.5 text-caption text-[var(--color-text-secondary)]">
              {row.session_id ? OCCUPANCY_LABEL[state] : 'لا توجد جلسة مفتوحة'}
              {row.session_id && now !== null && row.opened_at
                ? ` · منذ ${occupiedLabel(minutesSince(row.opened_at, now))}`
                : ''}
            </p>
          </div>
          <button
            type="button"
            onClick={onClose}
            aria-label="إغلاق"
            className="flex h-11 w-11 items-center justify-center rounded-[var(--radius-md)] text-[var(--color-text-secondary)] hover:bg-[var(--color-surface-sunken)]"
          >
            <X className="h-5 w-5" />
          </button>
        </header>

        {row.session_id ? (
          <>
            <div className="grid grid-cols-3 gap-2 border-b border-[var(--color-border)] px-4 py-3">
              <Metric label="الإجمالي" value={formatMoney(row.total_amount, currency)} />
              <Metric label="مدفوع" value={formatMoney(row.paid_amount, currency)} tone="success" />
              <Metric label="غير مدفوع" value={formatMoney(unpaid, currency)} tone={unpaid > 0 ? 'warn' : undefined} />
            </div>

            <div className="min-h-0 flex-1 overflow-y-auto px-4 py-3">
              <p className="section-title">طلبات الجلسة ({row.orders_count})</p>
              {loading ? (
                <p className="py-6 text-center text-sm text-[var(--color-text-secondary)]">نجيب الطلبات…</p>
              ) : orders.length === 0 ? (
                <p className="py-6 text-center text-sm text-[var(--color-text-secondary)]">
                  لا توجد طلبات بعد على هذه الجلسة.
                </p>
              ) : (
                <ul className="space-y-1.5">
                  {orders.map((o) => (
                    <li
                      key={o.id}
                      className="flex items-center justify-between gap-2 rounded-[var(--radius-md)] border border-[var(--color-border)] px-3 py-2"
                    >
                      <div className="flex min-w-0 items-center gap-2">
                        <span className="text-label font-bold" dir="ltr">
                          #{o.order_number}
                        </span>
                        <StatusChip status={o.status} />
                      </div>
                      <div className="flex items-center gap-2">
                        {o.paid_at ? (
                          <span className="text-caption font-semibold text-[var(--color-success)]">مدفوع</span>
                        ) : o.status !== 'cancelled' ? (
                          <button
                            type="button"
                            onClick={() => void payOrder(o.id)}
                            disabled={busy}
                            className="min-h-9 rounded-full border border-[var(--color-border-strong)] px-2.5 text-caption font-semibold text-[var(--color-text-secondary)] hover:bg-[var(--color-surface-sunken)]"
                          >
                            تحصيل
                          </button>
                        ) : null}
                        <span className="text-sm font-semibold tabular-nums" dir="ltr">
                          {formatMoney(o.total_amount, currency)}
                        </span>
                      </div>
                    </li>
                  ))}
                </ul>
              )}
            </div>

            <footer className="flex flex-wrap gap-2 border-t border-[var(--color-border)] px-4 py-3">
              <Button variant="secondary" size="sm" onClick={() => void collect()} disabled={busy || unpaid <= 0}>
                <Receipt className="h-4 w-4" />
                تحصيل {unpaid > 0 ? formatMoney(unpaid, currency) : ''}
              </Button>
              <Button variant="danger" size="sm" onClick={() => setClosing(true)} disabled={busy}>
                إغلاق الطاولة
              </Button>
            </footer>
          </>
        ) : (
          <div className="px-4 py-8 text-center">
            <p className="text-sm text-[var(--color-text-secondary)]">
              هذي الطاولة متاحة — أول طلب من باركودها يفتح جلسة تلقائيًا.
            </p>
            <Button className="mt-4" variant="secondary" size="sm" onClick={onClose}>
              تم
            </Button>
          </div>
        )}
      </div>

      {closing && (
        <div
          className="fixed inset-0 z-[var(--z-modal-backdrop)] flex items-end justify-center bg-black/50 sm:items-center"
          role="dialog"
          aria-modal="true"
          aria-labelledby="close-title"
          onClick={(e) => {
            if (e.target === e.currentTarget) setClosing(false);
          }}
          onKeyDown={(e) => {
            if (e.key === 'Escape') setClosing(false);
          }}
        >
          <form
            className="w-full max-w-md rounded-t-[14px] bg-[var(--color-surface)] p-4 pb-safe-bottom sm:rounded-[14px] sm:pb-4"
            onSubmit={(e) => {
              e.preventDefault();
              void submitClose(hasActive);
            }}
          >
            <h3 id="close-title" className="text-h2">
              إغلاق طاولة {row.number}
            </h3>
            {hasActive ? (
              <p className="mt-2 rounded-[var(--radius-md)] border border-[var(--color-warn)] bg-[var(--color-warn-tint)] px-3 py-2 text-sm text-[var(--color-warn)]">
                فيها {row.active_orders} طلب لم يُسلَّم بعد. الإغلاق لا يلغي الطلبات — المطبخ يظل يشوفها.
              </p>
            ) : (
              <p className="mt-2 text-sm text-[var(--color-text-secondary)]">
                كل الطلبات مسلّمة. تقدر تضيف سببًا اختياريًا للسجل.
              </p>
            )}

            <label className="label mt-3" htmlFor="close-reason">
              سبب الإغلاق {hasActive ? '(إلزامي)' : '(اختياري)'}
            </label>
            <textarea
              id="close-reason"
              className={`textarea ${reasonError ? 'input-error' : ''}`}
              value={reason}
              onChange={(e) => {
                setReason(e.target.value);
                setReasonError('');
              }}
              maxLength={200}
              aria-invalid={Boolean(reasonError)}
              aria-describedby={reasonError ? 'close-reason-error' : undefined}
              placeholder={hasActive ? 'مثال: الزبون خرج قبل التقديم' : 'مثال: انتهت الجلسة'}
            />
            {reasonError && (
              <p id="close-reason-error" role="alert" className="error-text">
                {reasonError}
              </p>
            )}

            <div className="mt-4 flex gap-2">
              <Button type="submit" variant="danger" size="sm" disabled={busy}>
                {hasActive ? 'أغلق رغم ذلك' : 'إغلاق الطاولة'}
              </Button>
              <Button type="button" variant="ghost" size="sm" onClick={() => setClosing(false)}>
                رجوع
              </Button>
            </div>
          </form>
        </div>
      )}
    </div>
  );
}

function Metric({ label, value, tone }: { label: string; value: string; tone?: 'success' | 'warn' }) {
  const colour =
    tone === 'success'
      ? 'text-[var(--color-success)]'
      : tone === 'warn'
        ? 'text-[var(--color-warn)]'
        : 'text-[var(--color-text)]';
  return (
    <div>
      <p className="text-caption text-[var(--color-text-secondary)]">{label}</p>
      <p className={`text-sm font-bold tabular-nums ${colour}`} dir="ltr">
        {value}
      </p>
    </div>
  );
}
