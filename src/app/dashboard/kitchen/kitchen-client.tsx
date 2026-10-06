'use client';

import { useCallback, useEffect, useState } from 'react';
import {
  buildTicket,
  STAGE_COLUMNS,
  STAGE_RANK,
  TAB_LABELS,
  type OrderRow,
} from '@/lib/kitchen-tickets';
import { toast } from 'sonner';

/* ========== FIX-C-002: Audio System (extracted hook) ========== */
import { useKitchenAudio } from '@/components/dashboard/kitchen/use-kitchen-audio';
// FIX-C-002: بطاقة الطلب مستخرجة
import { KitchenTicket } from '@/components/dashboard/kitchen/kitchen-ticket';
// FIX-C-003 (audit 2.4): العنوان الوامض + لوحة الطلبات/Realtime + الأوامر
// مستخرجة — نقل حرفي بدون تغيير سلوك
import { useTitleFlash } from '@/components/dashboard/kitchen/use-title-flash';
import { useKitchenOrders } from '@/components/dashboard/kitchen/use-kitchen-orders';
import { useKitchenActions } from '@/components/dashboard/kitchen/use-kitchen-actions';
import {
  useKitchenServiceRequests,
  type ServiceRequestRow,
} from '@/components/dashboard/kitchen/use-kitchen-service-requests';

/* ========== Component ========== */

export function KitchenClient({
  projectId,
  projectName,
  initialOrders,
  initialServiceRequests = [],
}: {
  projectId: string;
  projectName: string;
  initialOrders: OrderRow[];
  /** Open «طلب موظف / طلب فاتورة» rows, seeded by the server render. */
  initialServiceRequests?: ServiceRequestRow[];
}) {
  const [soundOn, setSoundOn] = useState(true);
  const [newOrderCount, setNewOrderCount] = useState(0);
  // These two are rendered on the SERVER as well, so their initial values must be
  // identical on both sides of hydration. They were not: `new Date().toLocaleTimeString(…)`
  // formats in the SERVER's UTC but in the merchant's +03 in the browser (never equal),
  // and `Date.now()` differs by the hydration latency — which also fed the «متأخر»
  // overdue badge. That is React error #418, firing on every KDS load and forcing React
  // to throw away the server HTML for the board. Starting null and filling them in on
  // mount is the fix: server and first client render agree, then the real values land.
  const [time, setTime] = useState<string | null>(null);
  const [now, setNow] = useState<number | null>(null);
  const [tab, setTab] = useState<'all' | 'dinein' | 'drivethru' | 'walkin'>('all');

  const { playChime, preloadChime, attachAudioResumeOnInteraction } = useKitchenAudio();
  const { flashTitle, clearFlash, syncTitle, resetTitle } = useTitleFlash();

  // Notification helper
  const notifyNewOrder = useCallback((orderNum: number) => {
    if (soundOn) {
      playChime();
      try { navigator.vibrate?.(200); } catch {}
    }
    toast.message('🔔 طلب جديد', {
      description: `#${orderNum}`,
    });
    setNewOrderCount((c) => c + 1);
  }, [soundOn, playChime]);

  // FIX-C-003: board state + realtime + polling extracted as-is
  const { orders, setOrders, fullRefresh } = useKitchenOrders({
    projectId,
    initialOrders,
    notifyNewOrder,
  });

  // «طلب موظف / طلب فاتورة» — same chime + badge as a new order, because a
  // customer waiting to be served is exactly as time-critical as a ticket.
  const notifyServiceRequest = useCallback(
    (kind: 'waiter' | 'bill', tableNumber: number | null) => {
      if (soundOn) {
        playChime();
        try { navigator.vibrate?.(200); } catch {}
      }
      toast.message(kind === 'waiter' ? '🔔 طلب موظف' : '🧾 طلب فاتورة', {
        description: tableNumber !== null ? `طاولة ${tableNumber}` : undefined,
      });
      setNewOrderCount((c) => c + 1);
    },
    [soundOn, playChime]
  );

  const { requests: serviceRequests, resolve: resolveServiceRequest } =
    useKitchenServiceRequests({
      projectId,
      initialRequests: initialServiceRequests,
      onNewRequest: notifyServiceRequest,
    });

  // Clock + tick — كل دقيقة (60s) لأن العرض بالدقائق.
  // The first tick runs immediately so the values are filled the moment we are
  // mounted (no waiting 60s for a clock), and only then can anything time-derived
  // differ from the server HTML — by which point hydration is already done.
  useEffect(() => {
    const tick = () => {
      setTime(new Date().toLocaleTimeString('ar-SA-u-nu-latn', { hour: '2-digit', minute: '2-digit' }));
      setNow(Date.now());
    };
    tick();
    const id = setInterval(tick, 60000);
    return () => clearInterval(id);
  }, []);

  // Preload chime on mount
  useEffect(() => {
    preloadChime();
    return attachAudioResumeOnInteraction();
  }, [preloadChime, attachAudioResumeOnInteraction]);

  // Flash title when new orders come in
  useEffect(() => {
    if (newOrderCount > 0) {
      flashTitle(newOrderCount);
    } else {
      clearFlash();
    }
    return () => clearFlash();
  }, [newOrderCount, flashTitle, clearFlash]);

  // Sync originalTitle on mount
  useEffect(() => {
    syncTitle();
    return () => resetTitle();
  }, [syncTitle, resetTitle]);

  // Clear new order badge when user interacts with the page
  const clearBadge = useCallback(() => {
    setNewOrderCount(0);
  }, []);

  // ---------- Ticket-level KDS ----------

  // FIX-C-003: advance/deliver/startAll extracted as-is
  const { advanceOrder, deliverOrder, startAll } = useKitchenActions({
    orders,
    setOrders,
    fullRefresh,
  });

  // ---------- Derived view ----------

  const tickets = orders.map(buildTicket);

  const countByTab = {
    all: tickets.length,
    dinein: tickets.filter((t) => t.order.type === 'dinein').length,
    drivethru: tickets.filter((t) => t.order.type === 'drivethru').length,
    walkin: tickets.filter((t) => t.order.type === 'walkin').length,
  };

  const visibleTickets =
    tab === 'all'
      ? tickets
      : tickets.filter((t) => (t.order.type ?? null) === tab);

  const sorted = [...visibleTickets].sort((a, b) => {
    const ra = STAGE_RANK[a.order.status] ?? 0;
    const rb = STAGE_RANK[b.order.status] ?? 0;
    if (ra !== rb) return ra - rb;
    return a.order.created_at.localeCompare(b.order.created_at);
  });

  const pendingCount = tickets.filter((t) => t.order.status === 'pending').length;
  // UX-U15: إحصاء الذروة الحي — عدد قيد التحضير
  const preparingCount = tickets.filter((t) => t.order.status === 'preparing').length;

  return (
    <div
      className="min-h-dvh bg-[var(--color-bg)]"
      /* audit T1 #20: a click-anywhere handler on a non-interactive div. It only clears a
         local badge - it is not an affordance - so it must not be announced or reachable;
         the explicit non-interactive role says so, and jsx-a11y accepts it. */
      role="presentation"
      onClick={clearBadge}
      onKeyDown={(e) => {
        if (e.key === 'Enter' || e.key === ' ') clearBadge();
      }}
    >
      {/* Header — Scan Grid: title + tabs + actions */}
      <header className="flex flex-wrap items-center justify-between gap-3 border-b border-[var(--color-border)] bg-[var(--color-surface)] px-6 py-4">
        <div className="flex items-center gap-2.5">
          <h1 className="font-display text-[16px] font-bold text-[var(--color-text)]">
            {projectName} — شاشة المطبخ
          </h1>
          <span className="flex items-center gap-1.5 text-[12.5px] font-semibold text-[var(--color-text-secondary)]">
            <span className="h-[7px] w-[7px] rounded-full bg-[var(--color-success)]" aria-hidden="true" />
            متصل مباشر
          </span>
        </div>

        <nav className="flex items-center gap-5 text-[13px]" aria-label="تصنيف الطلبات">
          {(['all', 'dinein', 'drivethru', 'walkin'] as const).map((t) => (
            <button
              key={t}
              type="button"
              onClick={() => setTab(t)}
              aria-pressed={tab === t}
              className={`relative min-h-[44px] font-semibold transition-colors ${
                tab === t
                  ? 'text-[var(--color-text)]'
                  : 'text-[var(--color-text-muted)] hover:text-[var(--color-text-secondary)]'
              }`}
            >
              {TAB_LABELS[t]}
              <span dir="ltr" className="ms-1.5 inline-block whitespace-nowrap font-mono text-[11.5px] tabular-nums opacity-70">
                · {String(countByTab[t]).padStart(2, '0')}
              </span>
              {tab === t && (
                <span className="absolute inset-x-0 bottom-0 h-0.5 bg-[var(--color-primary)]" />
              )}
            </button>
          ))}
        </nav>

        {/* FIX-A-006: إعلام قارئ الشاشة بوصول طلبات جديدة */}
        <div aria-live="polite" aria-atomic="true" className="sr-only">
          {pendingCount > 0 ? `وصل ${pendingCount} طلبات جديدة` : ''}
        </div>

        <div className="flex items-center gap-2.5">
          {pendingCount > 0 && (
            <button
              type="button"
              onClick={startAll}
              className="flex min-h-[44px] items-center gap-1.5 rounded-[7px] bg-[var(--color-primary)] px-4 text-[12px] font-bold text-white transition-colors hover:bg-[var(--color-primary-hover)]"
            >
              ⚡ بدء الكل ({pendingCount})
            </button>
          )}
          {/* UX-U15: مؤشر الذروة الحي */}
          <span className="flex items-center gap-1.5 rounded-[7px] bg-[var(--color-primary-tint)] px-3 py-1.5 text-[12px] font-bold tabular-nums text-[var(--color-primary)]" aria-live="polite">
            قيد التحضير: {preparingCount}
          </span>
          <span className="font-mono text-[15px] tabular-nums text-[var(--color-text-muted)]" dir="ltr">
            {time ?? '--:--'}
          </span>
          <button
            type="button"
            onClick={(e) => {
              e.stopPropagation();
              setSoundOn((s) => !s);
            }}
            aria-label={soundOn ? 'كتم الصوت' : 'تفعيل الصوت'}
            aria-pressed={soundOn}
            className="flex min-h-[44px] items-center rounded-[7px] border border-[var(--color-border)] bg-[var(--color-surface)] px-3 text-xs font-semibold text-[var(--color-text-secondary)] transition-colors hover:border-[var(--color-primary)]"
          >
            <span aria-hidden="true">{soundOn ? '🔊' : '🔇'}</span>
          </button>
          <button
            type="button"
            onClick={(e) => {
              e.stopPropagation();
              if (!soundOn) setSoundOn(true);
              playChime();
              toast.success('🔔 صوت التنبيه', { description: 'صوت الإشعار يعمل ✅' });
            }}
            title="اختبار الصوت"
            className="flex min-h-[44px] items-center rounded-[7px] border border-[var(--color-border)] bg-[var(--color-surface)] px-3 text-xs font-semibold text-[var(--color-text-secondary)] transition-colors hover:border-[var(--color-success)]"
          >
            <span aria-hidden="true">🔊</span> اختبار
          </button>
        </div>
      </header>

      {/* Service requests — «طلب موظف / طلب فاتورة» from the table menu.
          A customer waiting to be served is as time-critical as a ticket, so
          this sits above the board (and rings the same chime). */}
      {serviceRequests.length > 0 && (
        <section
          className="border-b border-[var(--color-border)] bg-[var(--color-primary-tint)] px-5 py-3"
          aria-label="طلبات الخدمة"
        >
          <div className="mb-2 flex items-center gap-2">
            <h2 className="text-[13.5px] font-bold text-[var(--color-primary)]">
              🔔 طلبات الخدمة
            </h2>
            <span className="rounded-full border border-[var(--color-primary)] px-2 py-0.5 text-[11.5px] font-bold tabular-nums text-[var(--color-primary)]">
              {serviceRequests.length}
            </span>
          </div>
          <ul className="flex gap-2.5 overflow-x-auto pb-1" style={{ scrollbarWidth: 'none' }}>
            {serviceRequests.map((r) => (
              <li
                key={r.id}
                className="flex min-w-[220px] shrink-0 items-center justify-between gap-3 rounded-[var(--radius-md)] border border-[var(--color-primary)] bg-[var(--color-surface)] px-3.5 py-2.5"
              >
                <div className="min-w-0">
                  <p className="text-[13.5px] font-bold text-[var(--color-text)]">
                    {r.type === 'waiter' ? 'طلب موظف' : 'طلب فاتورة'}
                  </p>
                  <p className="text-[12px] font-semibold text-[var(--color-text-secondary)]">
                    طاولة{' '}
                    <span dir="ltr" className="tabular-nums">
                      {String(r.tables?.number ?? '—').padStart(2, '0')}
                    </span>
                  </p>
                </div>
                <button
                  type="button"
                  onClick={() => void resolveServiceRequest(r.id)}
                  className="min-h-[44px] shrink-0 rounded-[var(--radius-md)] bg-[var(--color-primary)] px-4 text-[12.5px] font-bold text-white transition-colors hover:bg-[var(--color-primary-hover)]"
                >
                  تم ✓
                </button>
              </li>
            ))}
          </ul>
        </section>
      )}

      {/* Board — Calm Surface mockup: three fixed stage columns */}
      <main
        className="flex gap-4 overflow-x-auto p-5"
        role="region"
        aria-label="تذاكر المطبخ"
        tabIndex={0}
      >
        {sorted.length === 0 ? (
          <div className="flex min-h-[40vh] w-full flex-col items-center justify-center rounded-lg border border-dashed border-[var(--color-border)] text-[var(--color-text-tertiary)]">
            <span className="text-2xl">📡</span>
            <span className="mt-2 text-[13px]">بانتظار الطلبات…</span>
          </div>
        ) : (
          STAGE_COLUMNS.map(([stage, label]) => {
            const stageTickets = sorted.filter((t) => t.order.status === stage);
            return (
              <section
                key={stage}
                className={`flex shrink-0 flex-col gap-3 min-w-[280px] flex-1`}
                aria-label={label}
              >
                <div className="flex items-center justify-between px-0.5">
                  <h2 className="text-[13.5px] font-bold text-[var(--color-text-secondary)]">
                    {label}
                  </h2>
                  <span className="rounded-full border border-[var(--color-border-strong)] bg-[var(--color-surface)] px-2.5 py-0.5 text-[12px] font-bold tabular-nums text-[var(--color-text-tertiary)]">
                    {stageTickets.length}
                  </span>
                </div>
                <div className="flex flex-col gap-2.5 overflow-y-auto pb-2">
                  {stageTickets.map((t) => (
                    <KitchenTicket
                      key={t.order.id}
                      ticket={t}
                      now={now}
                      onStart={() => advanceOrder(t.order.id, 'preparing', 'preparing')}
                      onReady={() => advanceOrder(t.order.id, 'ready', 'ready')}
                      onDeliver={() => deliverOrder(t.order.id)}
                    />
                  ))}
                </div>
              </section>
            );
          })
        )}
      </main>
    </div>
  );
}
