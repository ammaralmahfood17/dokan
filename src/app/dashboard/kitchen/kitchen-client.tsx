'use client';

import { useCallback, useEffect, useMemo, useState } from 'react';
import {
  buildTicket,
  STAGE_COLUMNS,
  STAGE_RANK,
  TAB_LABELS,
  type OrderRow,
} from '@/lib/kitchen-tickets';
import { toast } from 'sonner';
import { Inbox, Maximize2, Minimize2, Volume2, VolumeX } from 'lucide-react';
import type { OrderStatus } from '@/lib/types';
import { arabicNewOrders } from '@/lib/arabic';

/* ========== FIX-C-002: Audio System (extracted hook) ========== */
import { NotificationsBanner } from '@/components/dashboard/notifications-banner';
import { useKitchenAudio } from '@/components/dashboard/kitchen/use-kitchen-audio';
import { useOnline } from '@/components/ui/use-online';
// FIX-C-002: بطاقة الطلب مستخرجة
import { KitchenTicket } from '@/components/dashboard/kitchen/kitchen-ticket';
import { KitchenTablesStrip } from '@/components/dashboard/kitchen/kitchen-tables-strip';
// FIX-C-003 (audit 2.4): العنوان الوامض + لوحة الطلبات/Realtime + الأوامر
// مستخرجة — نقل حرفي بدون تغيير سلوك
import { useTitleFlash } from '@/components/dashboard/kitchen/use-title-flash';
import { useKitchenOrders } from '@/components/dashboard/kitchen/use-kitchen-orders';
import { useKitchenActions } from '@/components/dashboard/kitchen/use-kitchen-actions';
import { useWakeLock } from '@/components/dashboard/kitchen/use-wake-lock';
import {
  useKitchenServiceRequests,
  type ServiceRequestRow,
} from '@/components/dashboard/kitchen/use-kitchen-service-requests';

/* ========== Component ========== */

export function KitchenClient({
  projectId,
  projectName,
  currency,
  initialOrders,
  initialServiceRequests = [],
  notificationState,
}: {
  projectId: string;
  projectName: string;
  currency: string;
  initialOrders: OrderRow[];
  /** Open «طلب موظف / طلب فاتورة» rows, seeded by the server render. */
  initialServiceRequests?: ServiceRequestRow[];
  /** Server-read alert wiring, shown as a prompt on the screen where a missed order costs money. */
  notificationState?: { telegramLinked: boolean; pushDevices: number };
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
  /** «الصالة» strip: filter the board to one table (null = every table). */
  const [tableFilter, setTableFilter] = useState<string | null>(null);
  // The board is three columns (~840px). At 375px it used to clip the second and third
  // stage behind a horizontal scroll with no affordance — the first ticket was cut off.
  // Below `lg` the stages become tabs (one column at a time); on tablet+ all stay visible.
  const [stage, setStage] = useState<OrderStatus>('pending');
  // A kitchen tablet runs this screen all shift; the dashboard chrome (sidebar, header) is
  // pure overhead at the counter. Fullscreen keeps one surface on the glass (UX-22).
  const [isFull, setIsFull] = useState(false);

  // A kitchen tablet must not dim mid-shift; no-op where the Wake Lock API is absent.
  useWakeLock();

  useEffect(() => {
    const sync = () => setIsFull(Boolean(document.fullscreenElement));
    document.addEventListener('fullscreenchange', sync);
    return () => document.removeEventListener('fullscreenchange', sync);
  }, []);

  const toggleFullscreen = () => {
    try {
      if (document.fullscreenElement) void document.exitFullscreen();
      else void document.documentElement.requestFullscreen?.();
    } catch {
      // browser refused (iOS Safari has no element fullscreen) — the screen still works
    }
  };

  const { playChime, ensureAudioReady, preloadChime, attachAudioResumeOnInteraction, audioReady } =
    useKitchenAudio();
  // Real connection state — the dot and label below used to be hard-coded.
  const isOnline = useOnline();
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

  // Offline, the board is a snapshot. «متصل مباشر» alone does not say how old
  // the snapshot is — a cook needs the age to decide whether to trust it.
  // Derived from the rows (max updated_at), not from a fetch timestamp: it is
  // the age of the DATA, survives a reconnect, and needs no state or effect.
  const lastSync = useMemo(() => {
    let newest = 0;
    for (const row of orders as Array<{ updated_at?: string | null }>) {
      const t = row.updated_at ? Date.parse(row.updated_at) : NaN;
      if (Number.isFinite(t) && t > newest) newest = t;
    }
    return newest || null;
  }, [orders]);

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
  // Perf: memoised on [orders, tab]. The board also re-renders once a minute on
  // the clock tick (the «متأخر» badge needs minute granularity), and rebuilding
  // every ticket + sorting + counting on that tick was pure busywork — the data
  // had not changed.
  const tickets = useMemo(() => orders.map(buildTicket), [orders]);

  const countByTab = useMemo(
    () => ({
      all: tickets.length,
      dinein: tickets.filter((t) => t.order.type === 'dinein').length,
      drivethru: tickets.filter((t) => t.order.type === 'drivethru').length,
      walkin: tickets.filter((t) => t.order.type === 'walkin').length,
    }),
    [tickets]
  );

  const sorted = useMemo(() => {
    const byType = tab === 'all' ? tickets : tickets.filter((t) => (t.order.type ?? null) === tab);
    const visible = tableFilter ? byType.filter((t) => t.order.table_id === tableFilter) : byType;
    return [...visible].sort((a, b) => {
      const ra = STAGE_RANK[a.order.status] ?? 0;
      const rb = STAGE_RANK[b.order.status] ?? 0;
      if (ra !== rb) return ra - rb;
      return a.order.created_at.localeCompare(b.order.created_at);
    });
  }, [tickets, tab, tableFilter]);

  // One pass instead of a filter per stage column.
  const stageBuckets = useMemo(() => {
    const m = new Map<string, typeof sorted>();
    for (const t of sorted) {
      const arr = m.get(t.order.status) ?? [];
      arr.push(t);
      m.set(t.order.status, arr);
    }
    return m;
  }, [sorted]);

  const pendingCount = useMemo(
    () => tickets.filter((t) => t.order.status === 'pending').length,
    [tickets]
  );
  // UX-U15: إحصاء الذروة الحي — عدد قيد التحضير
  const preparingCount = useMemo(
    () => tickets.filter((t) => t.order.status === 'preparing').length,
    [tickets]
  );

  return (
    <div
      className="flex min-h-dvh flex-col bg-[var(--color-bg)]"
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
        <div className="flex flex-wrap items-center gap-2.5">
          <h1 className="font-display text-[16px] font-bold text-[var(--color-text)]">
            {projectName} — شاشة المطبخ
          </h1>
          <span
            role="status"
            aria-live="polite"
            className={`flex items-center gap-1.5 text-[12.5px] font-semibold ${
              isOnline ? 'text-[var(--color-text-secondary)]' : 'text-[var(--color-danger)]'
            }`}
          >
            <span
              className={`h-[7px] w-[7px] rounded-full ${
                isOnline ? 'bg-[var(--color-success)]' : 'bg-[var(--color-danger)]'
              }`}
              aria-hidden="true"
            />
            {isOnline ? 'متصل مباشر' : 'غير متصل — الطلبات ما توصل'}
          </span>
          {lastSync !== null && (
            <span className="text-caption text-[var(--color-text-muted)]">
              آخر تحديث{' '}
              <span dir="ltr" className="font-mono tabular-nums">
                {new Date(lastSync).toLocaleTimeString('en-GB', {
                  hour: '2-digit',
                  minute: '2-digit',
                })}
              </span>
            </span>
          )}
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
              <span dir="ltr" className="ms-1.5 inline-block whitespace-nowrap font-mono text-caption tabular-nums opacity-70">
                · {countByTab[t]}
              </span>
              {tab === t && (
                <span className="absolute inset-x-0 bottom-0 h-0.5 bg-[var(--color-primary)]" />
              )}
            </button>
          ))}
        </nav>

        {/* FIX-A-006: إعلام قارئ الشاشة بوصول طلبات جديدة */}
        <div aria-live="polite" aria-atomic="true" className="sr-only">
          {arabicNewOrders(pendingCount)}
        </div>

        <div className="flex flex-wrap items-center gap-2.5">
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
          <span className="whitespace-nowrap font-mono text-[15px] tabular-nums text-[var(--color-text-muted)]" dir="ltr">
            {time ?? '--:--'}
          </span>
          <button
            type="button"
            onClick={toggleFullscreen}
            aria-label={isFull ? 'إنهاء ملء الشاشة' : 'ملء الشاشة'}
            aria-pressed={isFull}
            className="flex min-h-[44px] min-w-[44px] items-center justify-center rounded-[7px] border border-[var(--color-border)] bg-[var(--color-surface)] text-[var(--color-text-secondary)] transition-colors hover:border-[var(--color-primary)]"
          >
            {isFull ? <Minimize2 className="h-5 w-5" /> : <Maximize2 className="h-5 w-5" />}
          </button>
          <button
            type="button"
            onClick={(e) => {
              e.stopPropagation();
              setSoundOn((s) => !s);
            }}
            aria-label={soundOn ? 'كتم الصوت' : 'تفعيل الصوت'}
            aria-pressed={soundOn}
            className="flex min-h-[44px] min-w-[44px] items-center justify-center rounded-[7px] border border-[var(--color-border)] bg-[var(--color-surface)] px-3 text-xs font-semibold text-[var(--color-text-secondary)] transition-colors hover:border-[var(--color-primary)]"
          >
            {soundOn ? (
              <Volume2 className="h-5 w-5" aria-hidden="true" />
            ) : (
              <VolumeX className="h-5 w-5" aria-hidden="true" />
            )}
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
            className="flex min-h-[44px] min-w-[44px] items-center justify-center rounded-[7px] border border-[var(--color-border)] bg-[var(--color-surface)] px-3 text-xs font-semibold text-[var(--color-text-secondary)] transition-colors hover:border-[var(--color-success)]"
          >
            <Volume2 className="h-4 w-4" aria-hidden="true" />
            <span className="ms-1">اختبار</span>
          </button>
        </div>
      </header>

      {/* A cold-booted board has a suspended AudioContext: the first order
          arrives silently. Ask for the one tap that unlocks it, and disappear
          the moment the context is running (or the cook muted the board). */}
      {soundOn && !audioReady && (
        <div className="flex flex-wrap items-center justify-between gap-3 border-b border-[var(--color-warn)]/30 bg-[var(--color-warn-tint)] px-6 py-2 text-[12.5px] font-semibold text-[var(--color-warn)]">
          <span>صوت التنبيه ما يشتغل قبل أول لمسة — الطلب الأول ممكن يوصلك صامت.</span>
          <button
            type="button"
            onClick={() => {
              ensureAudioReady();
              playChime();
            }}
            className="min-h-[36px] rounded-[var(--radius-md)] bg-[var(--color-warn)] px-3 text-[12.5px] font-bold text-white"
          >
            تفعيل الصوت
          </button>
        </div>
      )}

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
            <span className="rounded-full border border-[var(--color-primary)] px-2 py-0.5 text-caption font-bold tabular-nums text-[var(--color-primary)]">
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

      {notificationState && (
        <NotificationsBanner
          telegramLinked={notificationState.telegramLinked}
          pushDevices={notificationState.pushDevices}
        />
      )}

      {/* Mobile stage switcher — the three-column board cannot fit 375px. */}
      <nav
        className="flex gap-1 border-b border-[var(--color-border)] px-5 lg:hidden"
        aria-label="مراحل الطلبات"
      >
        {STAGE_COLUMNS.map(([s, label]) => (
          <button
            key={s}
            type="button"
            onClick={() => setStage(s)}
            aria-pressed={stage === s}
            className={`relative min-h-[48px] flex-1 text-[13px] font-bold transition-colors ${
              stage === s ? 'text-[var(--color-text)]' : 'text-[var(--color-text-muted)]'
            }`}
          >
            {label}
            <span dir="ltr" className="ms-1 inline-block font-mono text-caption tabular-nums opacity-70">
              · {String((stageBuckets.get(s) ?? []).length).padStart(2, '0')}
            </span>
            {stage === s && (
              <span className="absolute inset-x-0 bottom-0 h-0.5 bg-[var(--color-primary)]" />
            )}
          </button>
        ))}
      </nav>

      <KitchenTablesStrip
        projectId={projectId}
        currency={currency}
        selected={tableFilter}
        onSelect={setTableFilter}
      />

      {/* Board — Calm Surface mockup: three fixed stage columns */}
      <main
        className="flex min-h-0 flex-1 gap-4 overflow-x-hidden p-5 lg:overflow-x-auto"
        role="region"
        aria-label="تذاكر المطبخ"
        tabIndex={0}
      >
        {sorted.length === 0 ? (
          <div className="flex min-h-[40vh] w-full flex-col items-center justify-center rounded-lg border border-dashed border-[var(--color-border)] text-[var(--color-text-tertiary)]">
            <Inbox className="h-7 w-7" aria-hidden="true" />
            <span className="mt-2 text-[13px]">بانتظار الطلبات…</span>
            <span className="mt-1 text-[12px] opacity-70">الطلب الجديد يظهر هنا تلقائيًا</span>
          </div>
        ) : (
          STAGE_COLUMNS.map(([columnStage, label]) => {
            const stageTickets = stageBuckets.get(columnStage) ?? [];
            return (
              <section
                key={columnStage}
                data-stage={columnStage}
                className={`min-h-0 min-w-0 flex-1 shrink-0 flex-col gap-3 lg:flex lg:min-w-[280px] ${
                  columnStage === stage ? 'flex' : 'hidden'
                }`}
                aria-label={label}
              >
                <div className="flex items-center justify-between px-0.5">
                  <h2 className="text-[15px] font-bold text-[var(--color-text-secondary)]">
                    {label}
                  </h2>
                  <span className="rounded-full border border-[var(--color-border-strong)] bg-[var(--color-surface)] px-2.5 py-0.5 text-[12px] font-bold tabular-nums text-[var(--color-text-tertiary)]">
                    {stageTickets.length}
                  </span>
                </div>
                <div className="flex min-h-0 flex-1 flex-col gap-2.5 overflow-y-auto pb-2">
                  {stageTickets.map((t) => (
                    <KitchenTicket
                      key={t.order.id}
                      ticket={t}
                      now={now}
                      onStart={() => advanceOrder(t.order.id, 'preparing', 'preparing')}
                      onReady={() => advanceOrder(t.order.id, 'ready', 'ready')}
                      onDeliver={() => deliverOrder(t.order.id)}
                      disabled={!isOnline}
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
