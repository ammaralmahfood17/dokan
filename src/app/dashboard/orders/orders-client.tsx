'use client';

import { useCallback, useDeferredValue, useEffect, useMemo, useRef, useState } from 'react';
import { ArrowUpDown, CalendarDays, Search, X } from 'lucide-react';
import { createClient } from '@/lib/supabase/client';
import { formatMoney } from '@/lib/utils';
import {
  ORDER_STATUS_LABELS,
  ORDER_TYPE_LABELS,
  type Order,
  type OrderItem,
  type OrderItemAddon,
  type OrderStatus,
} from '@/lib/types';
import { EmptyState } from '@/components/ui/empty-state';
import { PullToRefresh } from '@/components/ui/pull-to-refresh';

const FILTERS: { value: OrderStatus | 'all'; label: string }[] = [
  { value: 'all', label: 'الكل' },
  { value: 'pending', label: 'جديد' },
  { value: 'preparing', label: 'تحضير' },
  { value: 'ready', label: 'جاهز' },
  { value: 'delivered', label: 'مسلّم' },
  { value: 'cancelled', label: 'ملغى' },
];

/** ترتيب مراحل الحالة — تسلسل حقيقي (عملية الطهي/التسليم) */
const STATUS_STEPS: OrderStatus[] = ['pending', 'preparing', 'ready', 'delivered'];

type OrderRow = Order & {
  tables?: { number: number; slug: string } | null;
  order_items?: OrderItem[];
};

/** YYYY-MM-DD بالتوقيت المحلي للمتصفح */
function toDateKey(d: Date): string {
  const y = d.getFullYear();
  const m = String(d.getMonth() + 1).padStart(2, '0');
  const day = String(d.getDate()).padStart(2, '0');
  return `${y}-${m}-${day}`;
}

/** نطاق [بداية اليوم المختار, بداية اليوم التالي) */
function dayRange(dateKey: string): { start: Date; end: Date } {
  const [y, m, d] = dateKey.split('-').map(Number);
  const start = new Date(y, m - 1, d);
  start.setHours(0, 0, 0, 0);
  const end = new Date(start);
  end.setDate(end.getDate() + 1);
  return { start, end };
}

export function OrdersClient({
  projectId,
  currency,
  initialOrders,
}: {
  projectId: string;
  currency: string;
  initialOrders: OrderRow[];
}) {
  const [orders, setOrders] = useState(initialOrders);
  const [filter, setFilter] = useState<OrderStatus | 'all'>('all');
  // التاريخ المعروض — اليوم افتراضيًا (التقويم مقيد بـ max=اليوم)
  const [dateKey, setDateKey] = useState(() => toDateKey(new Date()));
  // بحث فوري — رقم الطلب / اسم المنتج / طاولة
  const [query, setQuery] = useState('');
  // FIX-P-002: تأجيل الفلترة — لا تحجب الـ main thread أثناء الكتابة
  const deferredQuery = useDeferredValue(query);
  // تحميل المزيد — إزاحة للصفحة التالية (50/صفحة)
  const [hasMore, setHasMore] = useState(true);
  const [loadingMore, setLoadingMore] = useState(false);
  // فرز: أحدث / أقدم / أعلى مبلغ
  const [sortBy, setSortBy] = useState<'newest' | 'oldest' | 'amount'>('newest');

  const isToday = dateKey === toDateKey(new Date());
  const mountedRef = useRef(false);

  // FIX-PAGE-001: how many rows the merchant has actually loaded. A plain
  // refresh used to re-query only .range(0,49) and REPLACE state, so every
  // realtime event (and the 60s heartbeat) silently threw away pages 2+ — the
  // merchant who scrolled was yanked back to the newest 50 orders. Track the
  // loaded span in a ref and re-query the same width on refresh.
  const loadedCountRef = useRef(initialOrders.length);

  const refresh = useCallback(
    async (key?: string, append = false) => {
      const target = key ?? dateKey;
      const { start, end } = dayRange(target);
      const supabase = createClient();
      // A different day starts fresh; the same day re-reads what was loaded.
      const span = key && key !== dateKey ? 50 : Math.max(50, loadedCountRef.current);
      const { data } = await supabase
        .from('orders')
        .select('*, tables(number, slug), order_items(*)')
        .eq('project_id', projectId)
        .is('service_type', null) // null = real order (not waiter/bill)
        .gte('created_at', start.toISOString())
        .lt('created_at', end.toISOString())
        .order('created_at', { ascending: false })
        .range(0, span - 1);
      if (data) {
        loadedCountRef.current = data.length;
        setOrders((prev) => {
          // When appending, merge by id (realtime may have added rows).
          if (!append) return data as unknown as OrderRow[];
          const byId = new Map(prev.map((o) => [o.id, o]));
          for (const o of data as unknown as OrderRow[]) byId.set(o.id, o);
          return [...byId.values()];
        });
        // A full page came back → there may be more.
        setHasMore(data.length >= span);
      }
    },
    [projectId, dateKey]
  );

  const loadMore = useCallback(async () => {
    if (loadingMore || !hasMore) return;
    setLoadingMore(true);
    const { start, end } = dayRange(dateKey);
    const supabase = createClient();
    const { data } = await supabase
      .from('orders')
      .select('*, tables(number, slug), order_items(*)')
      .eq('project_id', projectId)
      .is('service_type', null)
      .gte('created_at', start.toISOString())
      .lt('created_at', end.toISOString())
      .order('created_at', { ascending: false })
      .range(orders.length, orders.length + 49);
    if (data) {
      const byId = new Map(orders.map((o) => [o.id, o]));
      for (const o of data as unknown as OrderRow[]) byId.set(o.id, o);
      const merged = [...byId.values()];
      loadedCountRef.current = merged.length;
      setOrders(merged);
      setHasMore(data.length === 50);
    }
    setLoadingMore(false);
  }, [loadingMore, hasMore, dateKey, orders, projectId]);

  // SSR (Vercel = UTC) يجلب نطاقًا مختلفًا عن نطاق المتصفح المحلي (Asia/Bahrain) —
  // إعادة جلب واحدة عند أول mount توحّد العرض على توقيت المستخدم.
  useEffect(() => {
    if (mountedRef.current) return;
    mountedRef.current = true;
    void refresh();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  // تاريخ محدد (تقويم) — يجلب مباشرة
  const selectDate = useCallback(
    (key: string) => {
      setDateKey(key);
      void refresh(key);
    },
    [refresh]
  );

  // اليوم / أمس — إزاحة من اليوم الحالي
  const selectDayOffset = useCallback(
    (offsetDays: number) => {
      const d = new Date();
      d.setDate(d.getDate() + offsetDays);
      const key = toDateKey(d);
      setDateKey(key);
      void refresh(key);
    },
    [refresh]
  );

  // Realtime — تحديث تلقائي لطلبات اليوم فقط (الأيام السابقة ثابتة:
  // ما يجي أحد يغيّر طلبات أمس أثناء عرضها)
  // M1: status callback + 30s poll fallback (same interval as KDS) so a
  // dropped realtime connection never leaves the page silently stale.
  const [realtimeOffline, setRealtimeOffline] = useState(false);

  useEffect(() => {
    const supabase = createClient();
    let refreshTimer: ReturnType<typeof setTimeout> | null = null;
    let pollInterval: ReturnType<typeof setInterval> | null = null;
    let channelActive = true;

    const stopPoll = () => {
      if (pollInterval) {
        clearInterval(pollInterval);
        pollInterval = null;
      }
    };

    // Safety net (2026-09-25): the 30s poll below only STARTS on a
    // CHANNEL_ERROR/CLOSED callback. A socket that connects and then stalls
    // silently fires neither, so the page stayed stale until a manual
    // refresh. This heartbeat runs regardless of socket health — realtime
    // normally wins the race by ~1s, so this is just insurance.
    const heartbeat = setInterval(() => {
      if (isToday) void refresh();
    }, 60_000);

    const channel = supabase
      .channel(`orders-${projectId}`)
      .on(
        'postgres_changes',
        {
          event: '*',
          schema: 'public',
          table: 'orders',
          // NOTE: no project_id filter here. RLS (orders_staff_* policies)
          // already isolates events to the caller's projects — verified
          // live. Combining filter+RLS on the same column made realtime
          // drop ALL events (kitchen orders took up to 30s to appear).
        },
        () => {
          if (!isToday) return;
          if (refreshTimer) clearTimeout(refreshTimer);
          refreshTimer = setTimeout(() => void refresh(), 500);
        }
      )
      .subscribe((status) => {
        if (!channelActive) return;
        if (status === 'SUBSCRIBED') {
          // Reconnected — clear the banner and stop the fallback poll.
          setRealtimeOffline(false);
          stopPoll();
        } else if (status === 'CHANNEL_ERROR' || status === 'CLOSED') {
          setRealtimeOffline(true);
          // Poll fallback: only while realtime is down (no double-fetching).
          if (!pollInterval) {
            pollInterval = setInterval(() => void refresh(), 30000);
          }
        }
      });

    return () => {
      channelActive = false;
      if (refreshTimer) clearTimeout(refreshTimer);
      clearInterval(heartbeat);
      stopPoll();
      void supabase.removeChannel(channel);
    };
  }, [projectId, refresh, isToday]);

  const filtered = useMemo(() => {
    let list = orders;
    if (filter !== 'all') list = list.filter((o) => o.status === filter);
    // بحث فوري: رقم الطلب / اسم المنتج / طاولة (FIX-P-002: deferredQuery)
    const q = deferredQuery.trim().toLowerCase();
    if (q) {
      list = list.filter((o) => {
        if (String(o.order_number).includes(q)) return true;
        if (o.tables && String(o.tables.number).includes(q)) return true;
        return (o.order_items ?? []).some((it) =>
          (it.product_name ?? '').toLowerCase().includes(q)
        );
      });
    }
    // فرز
    const sorted = [...list];
    if (sortBy === 'oldest') {
      sorted.sort((a, b) => a.created_at.localeCompare(b.created_at));
    } else if (sortBy === 'amount') {
      sorted.sort((a, b) => Number(b.total_amount) - Number(a.total_amount));
    }
    // newest = الترتيب الافتراضي من الـ query (created_at desc)
    return sorted;
  }, [orders, filter, deferredQuery, sortBy]);

  // مجموع مبيعات اليوم (غير الملغاة) — يعرض في الرأس
  const dayTotal = useMemo(
    () =>
      orders
        .filter((o) => o.status !== 'cancelled')
        .reduce((s, o) => s + Number(o.total_amount), 0),
    [orders]
  );

  // عدادات حية لكل حالة — معلومة حقيقية من البيانات المعروضة
  const counts = useMemo(() => {
    const c: Record<OrderStatus | 'all', number> = {
      all: orders.length,
      pending: 0,
      preparing: 0,
      ready: 0,
      delivered: 0,
      cancelled: 0,
    };
    for (const o of orders) c[o.status] += 1;
    return c;
  }, [orders]);

  return (
    <div className="page">
      <PullToRefresh onRefresh={() => void refresh()}>
      <div className="page-header">
        <div>
          <h1>الطلبات</h1>
          <p>متابعة فقط · الحالة تتحدث من شاشة المطبخ</p>
        </div>
        <div className="flex flex-col items-end gap-1">
          <p className="text-[11px] text-[var(--color-text-secondary)]">مبيعات اليوم</p>
          <p className="font-mono text-lg font-bold tabular-nums text-[var(--color-text)]" dir="ltr">
            {formatMoney(dayTotal, currency)}
          </p>
        </div>
      </div>

      {realtimeOffline && (
        <div
          role="status"
          className="mb-4 flex items-center gap-2 rounded-[var(--radius-md)] border border-[var(--color-danger)]/20 bg-[var(--color-danger-tint)] px-3 py-2 text-xs font-medium text-[var(--color-danger)]"
        >
          <span className="h-1.5 w-1.5 shrink-0 animate-pulse rounded-full bg-[var(--color-danger)]" />
          انقطع الاتصال المباشر — يُحدَّث تلقائيًا كل 30 ثانية
        </div>
      )}

      {/* Date picker — اليوم/أمس + تقويم (لا مستقبل) */}
      <div className="mb-4 flex flex-wrap items-center gap-1.5">
        <button
          type="button"
          onClick={() => selectDayOffset(0)}
          aria-pressed={isToday}
          className={`flex min-h-[44px] items-center rounded-full px-4 text-xs font-bold transition-colors ${
            isToday
              ? 'bg-[var(--color-primary)] text-white'
              : 'border border-[var(--color-border)] bg-[var(--color-surface)] text-[var(--color-text-secondary)] hover:border-[var(--color-primary)]'
          }`}
        >
          اليوم
        </button>
        <button
          type="button"
          onClick={() => selectDayOffset(-1)}
          className="flex min-h-[44px] items-center rounded-full border border-[var(--color-border)] bg-[var(--color-surface)] px-4 text-xs font-bold text-[var(--color-text-secondary)] transition-colors hover:border-[var(--color-primary)]"
        >
          أمس
        </button>
        <label className="flex min-h-[44px] cursor-pointer items-center gap-1.5 rounded-full border border-[var(--color-border)] bg-[var(--color-surface)] px-3 text-xs font-semibold text-[var(--color-text-secondary)]">
          <CalendarDays className="h-4 w-4" aria-hidden="true" />
          <input
            type="date"
            value={dateKey}
            max={toDateKey(new Date())}
            onChange={(e) => {
              if (e.target.value) selectDate(e.target.value);
            }}
            className="bg-transparent text-xs font-semibold outline-none"
            aria-label="اختيار تاريخ"
          />
        </label>
      </div>

      {/* بحث فوري + فرز */}
      <div className="mb-4 flex flex-wrap items-center gap-2">
        <div className="relative min-w-[200px] flex-1">
          <Search className="pointer-events-none absolute start-3 top-1/2 h-4 w-4 -translate-y-1/2 text-[var(--color-text-muted)]" />
          <input
            type="search"
            inputMode="search"
            value={query}
            onChange={(e) => setQuery(e.target.value)}
            placeholder="ابحث برقم الطلب أو المنتج أو الطاولة…"
            aria-label="ابحث في الطلبات"
            maxLength={60}
            className="input min-h-[44px] w-full ps-10! pe-10!"
          />
          {query && (
            <button
              type="button"
              onClick={() => setQuery('')}
              aria-label="مسح البحث"
              className="absolute end-2 top-1/2 flex h-8 w-8 -translate-y-1/2 items-center justify-center rounded-full text-[var(--color-text-muted)] hover:bg-[var(--color-surface-sunken)]"
            >
              <X className="h-4 w-4" />
            </button>
          )}
        </div>
        <label className="flex min-h-[44px] cursor-pointer items-center gap-1.5 rounded-full border border-[var(--color-border)] bg-[var(--color-surface)] px-3 text-xs font-semibold text-[var(--color-text-secondary)]">
          <ArrowUpDown className="h-3.5 w-3.5" />
          <select
            value={sortBy}
            onChange={(e) => setSortBy(e.target.value as 'newest' | 'oldest' | 'amount')}
            aria-label="ترتيب الطلبات"
            className="bg-transparent text-xs font-semibold outline-none"
          >
            <option value="newest">الأحدث</option>
            <option value="oldest">الأقدم</option>
            <option value="amount">الأعلى مبلغًا</option>
          </select>
        </label>
      </div>

      {/* Filters — مع عدادات حية */}
      <div className="mb-4 flex flex-wrap gap-1.5">
        {FILTERS.map((f) => (
          <button
            key={f.value}
            type="button"
            onClick={() => setFilter(f.value)}
            aria-pressed={filter === f.value}
            className={`flex min-h-[44px] items-center gap-1.5 rounded-full px-3 py-1 text-xs font-bold transition-colors ${
              filter === f.value
                ? 'bg-[var(--color-primary)] text-white'
                : 'bg-[var(--color-surface)] text-[var(--color-text-secondary)] border border-[var(--color-border)]'
            }`}
          >
            {f.label}
            <span
              className={`rounded-full px-1.5 py-0.5 text-[10px] tabular-nums ${
                filter === f.value
                  ? 'bg-white/20 text-white'
                  : 'bg-[var(--color-bg)] text-[var(--color-text-muted)]'
              }`}
            >
              {counts[f.value]}
            </span>
          </button>
        ))}
      </div>

      {!filtered.length ? (
        <EmptyState
          title="ما فيه طلبات في هذا اليوم"
          description={isToday ? 'أول طلب بيظهر هنا مباشرة.' : 'جرب اختيار يوم آخر.'}
        />
      ) : (
        <div className="space-y-3">
          {filtered.map((order) => (
            <article key={order.id} className="dashboard-card card">
              <div className="flex flex-wrap items-start justify-between gap-3 border-b border-[var(--color-border)] px-4 py-3">
                <div>
                  <div className="flex flex-wrap items-center gap-2">
                    <span className="text-sm font-bold tabular-nums" dir="ltr">order-{order.order_number}</span>
                    <span className={`badge badge-${order.status}`}>
                      {ORDER_STATUS_LABELS[order.status]}
                    </span>
                    <span className="text-xs text-[var(--color-text-muted)]">
                      {ORDER_TYPE_LABELS[order.type]}
                    </span>
                  </div>
                  <p className="mt-0.5 text-xs text-[var(--color-text-secondary)]">
                    {order.tables
                      ? `طاولة ${order.tables.number}`
                      : 'بدون طاولة'}{' '}
                    · {new Date(order.created_at).toLocaleString('ar-BH-u-nu-latn')}
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
                  <p className="mt-1 text-[10px] text-[var(--color-text-muted)]" dir="rtl">
                    {ORDER_STATUS_LABELS[order.status]}
                  </p>
                </div>
              ) : (
                <p className="border-b border-[var(--color-border)] px-4 py-2 text-[10px] font-bold text-[var(--color-danger)]">
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
                            {(item.addons as OrderItemAddon[])
                              .map((a) => a.name)
                              .join(' · ')}
                          </span>
                        )}
                        {item.notes && (
                          <span className="block text-xs text-[var(--color-text-muted)]">
                            {item.notes}
                          </span>
                        )}
                      </span>
                      <span className="text-[var(--color-text-secondary)] shrink-0 tabular-nums">
                        {formatMoney(
                          Number(item.unit_price) * item.quantity,
                          currency
                        )}
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
          ))}
        </div>
      )}
      {/* تحميل المزيد — صفحة تالية (50/صفحة) */}
      {hasMore && filtered.length >= 50 && (
        <div className="mt-5 flex justify-center">
          <button
            type="button"
            onClick={() => void loadMore()}
            disabled={loadingMore}
            className="min-h-[44px] rounded-[var(--radius-md)] border border-[var(--color-border)] bg-[var(--color-surface)] px-6 text-sm font-bold text-[var(--color-text-secondary)] transition-colors hover:border-[var(--color-primary)] hover:text-[var(--color-primary)] disabled:opacity-50"
          >
            {loadingMore ? 'جاري التحميل…' : 'تحميل المزيد'}
          </button>
        </div>
      )}
      </PullToRefresh>
    </div>
  );
}
