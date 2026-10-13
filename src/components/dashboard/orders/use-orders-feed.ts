'use client';

import { useCallback, useDeferredValue, useEffect, useMemo, useRef, useState } from 'react';
import { createClient } from '@/lib/supabase/client';
import { countStatuses, sumDaySales, type StatusCounts } from '@/lib/order-stats';
import { usePostgresSubscription } from '@/lib/realtime/use-postgres-subscription';
import {
  PAGE_SIZE,
  dayRange,
  filterOrders,
  shiftDateKey,
  sortOrders,
  toDateKey,
  type SortKey,
} from '@/lib/order-filters';
import type { Order, OrderItem, OrderStatus } from '@/lib/types';

export type OrderRow = Order & {
  tables?: { number: number; slug: string } | null;
  order_items?: OrderItem[];
};

/**
 * Everything stateful behind the orders page: the paged reads, the full-day
 * header figures, the realtime subscription and the three refresh cadences.
 *
 * WHY THIS EXISTS (architecture review 2026-10-13, wave 4): this is the half of
 * `orders-client.tsx` that could not be unit-tested while it sat inside the
 * component. The rules it applies are in `lib/order-filters.ts` (pure, tested);
 * this hook is the wiring, and the component below it is only markup.
 *
 * THREE cadences, on purpose — each closes a hole the others leave:
 *   - realtime event  → 500ms-debounced refresh (the fast path)
 *   - 15s poll        → only while the channel is NOT live
 *   - 60s heartbeat   → always, because a socket can connect and then stall,
 *                       firing neither CHANNEL_ERROR nor CLOSED
 */
export function useOrdersFeed({
  projectId,
  initialOrders,
}: {
  projectId: string;
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
  const [loadingMore, setLoadingMore] = useState(false);
  // فرز: أحدث / أقدم / أعلى مبلغ
  const [sortBy, setSortBy] = useState<SortKey>('newest');

  const isToday = dateKey === toDateKey(new Date());
  const mountedRef = useRef(false);

  // FIX-PAGE-001 (2026-09-26) + FIX-PAGE-002/003/004 (2026-09-28):
  //
  // `loaded` is the ONE source of truth for "how far the merchant has paged".
  // A plain refresh used to re-query only .range(0,49) and REPLACE state, so
  // every realtime event (and the 60s heartbeat) silently threw away pages 2+.
  // It now re-reads the loaded span, and everything else derives from it:
  //
  //   hasMore   — derived, never stored. It used to be state written by TWO
  //               disagreeing rules (loadMore: `data.length === 50`, refresh:
  //               `data.length >= span`), so a page landing exactly on the page
  //               size left it true forever and the merchant clicked into empty
  //               pages. React's ref lint also rejects reading a ref in render,
  //               which is why this is plain state and not a ref.
  //   the gate   — keyed on `loaded`, NEVER on `filtered`. The old
  //               `hasMore && filtered.length >= 50` made the button
  //               unreachable under any rare filter (12 «مسلّم» out of 100 →
  //               12 < 50 → never rendered), silently capping that view at
  //               page 1.
  //   dayTotal / counts — from a separate full-day read (dayStats), not from
  //               the loaded page, so a busy day no longer under-reports.
  //
  // Two holders, one value: `loaded` is state (the render reads it for hasMore),
  // `loadedRef` is the same value for async callbacks that must NOT re-create
  // on every page. React's ref lint rejects reading a ref DURING render, which
  // is exactly the split we need — state for render, ref for the callback.
  const [loaded, setLoaded] = useState(initialOrders.length);
  const loadedRef = useRef(initialOrders.length);
  const hasMore = loaded >= PAGE_SIZE;

  /** Write both holders. Never touch one without the other. */
  const setLoadedCount = useCallback((n: number) => {
    loadedRef.current = n;
    setLoaded(n);
  }, []);

  // FIX-PAGE-004 (2026-09-28): مبيعات اليوم and the status chips were computed
  // from the LOADED rows, so on a busy day the header total under-reported and
  // the chips counted only the pages fetched so far. A lean second read
  // (id,status,total_amount only — no order_items/tables blobs) returns the
  // whole day for ~90 bytes per order, so the header is now exact. It is a
  // separate fetch on purpose: the main list is paged, the header is not.
  const [dayStats, setDayStats] = useState<{ total: number; counts: StatusCounts }>(() => ({
    total: sumDaySales(initialOrders),
    counts: countStatuses(initialOrders),
  }));

  const refreshDayStats = useCallback(
    async (key?: string) => {
      const { start, end } = dayRange(key ?? dateKey);
      const supabase = createClient();
      // Two columns only. `order_items(*)` and `tables(*)` are the heavy part
      // of the orders row and the header needs neither — measured live at
      // ~90 bytes/order for this shape vs the full row.
      const { data } = await supabase
        .from('orders')
        .select('status,total_amount')
        .eq('project_id', projectId)
        .is('service_type', null)
        .gte('created_at', start.toISOString())
        .lt('created_at', end.toISOString());
      if (!data) return;
      setDayStats({
        total: sumDaySales(data as { status: OrderStatus; total_amount: number }[]),
        counts: countStatuses(data as { status: OrderStatus }[]),
      });
    },
    [projectId, dateKey]
  );

  const refresh = useCallback(
    async (key?: string, append = false) => {
      const target = key ?? dateKey;
      const { start, end } = dayRange(target);
      const supabase = createClient();
      // A different day starts fresh; the same day re-reads what was loaded.
      // Read through the ref, not `loaded`: `refresh` must keep a STABLE
      // identity because the realtime channel below depends on it, and
      // resubscribing on every appended page would drop live events. The ref
      // is never read during render (react-hooks/refs rejects that), only
      // inside this async callback, which is where it belongs.
      const span = key && key !== dateKey ? PAGE_SIZE : Math.max(PAGE_SIZE, loadedRef.current);
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
        setOrders((prev) => {
          // When appending, merge by id (realtime may have added rows).
          if (!append) return data as unknown as OrderRow[];
          const byId = new Map(prev.map((o) => [o.id, o]));
          for (const o of data as unknown as OrderRow[]) byId.set(o.id, o);
          return [...byId.values()];
        });
        setLoadedCount(data.length);
        void refreshDayStats(target);
      }
    },
    [projectId, dateKey, refreshDayStats, setLoadedCount]
  );

  const loadMore = useCallback(async () => {
    if (loadingMore) return;
    setLoadingMore(true);
    const { start, end } = dayRange(dateKey);
    const supabase = createClient();
    // Offset from the ref so a burst of clicks can't reuse a stale closure.
    // (React batches, so `loadingMore` only flips on the next render; the ref
    // is already correct by then, which is the point of having both.)
    const from = loadedRef.current;
    const { data } = await supabase
      .from('orders')
      .select('*, tables(number, slug), order_items(*)')
      .eq('project_id', projectId)
      .is('service_type', null)
      .gte('created_at', start.toISOString())
      .lt('created_at', end.toISOString())
      .order('created_at', { ascending: false })
      .range(from, from + PAGE_SIZE - 1);
    if (data) {
      const byId = new Map(orders.map((o) => [o.id, o]));
      for (const o of data as unknown as OrderRow[]) byId.set(o.id, o);
      setOrders([...byId.values()]);
      setLoadedCount(from + data.length);
      void refreshDayStats();
    }
    setLoadingMore(false);
  }, [loadingMore, dateKey, projectId, orders, refreshDayStats, setLoadedCount]);

  // الخادم (Vercel = UTC) والآن يجلب نطاق يوم البحرين نفسه الذي يجلبه المتصفح
  // المحلي (+03) — فالعرض صحيح من أول paint. تبقى إعادة الجلب هذه شبكة أمان
  // لوقت مستخدم خارج +03 (لا يطابق نطاق المتصفح).
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
      // إزاحة على مفتاح يوم البحرين نفسه، لا على تاريخ الجهاز: `new Date()` +
      // setDate يحسب على يوم المتصفح، فجهاز خارج +03 يعطي مفتاحًا مزحزحًا.
      const key = shiftDateKey(toDateKey(new Date()), offsetDays);
      setDateKey(key);
      void refresh(key);
    },
    [refresh]
  );

  // Realtime — تحديث تلقائي لطلبات اليوم فقط (الأيام السابقة ثابتة:
  // ما يجي أحد يغيّر طلبات أمس أثناء عرضها)
  // The offline banner is DERIVED from the channel status, not mirrored into state: a setState in an
  // effect is a cascading render (this repo's lint rule) and a second source of truth.

  // Realtime through the shared hook: the session token is attached to the socket BEFORE the
  // channel opens (see use-postgres-subscription.ts for the 27s end-to-end measurement that made
  // this necessary). The old version here stopped its fallback poll on SUBSCRIBED and only
  // restarted it on CHANNEL_ERROR/CLOSED — and a subscription authorized as `anon` reports
  // SUBSCRIBED while delivering nothing, so the page could sit stale with the poll switched off.
  const refreshTimer = useRef<ReturnType<typeof setTimeout> | null>(null);

  const onOrdersEvent = useCallback(() => {
    if (!isToday) return;
    if (refreshTimer.current) clearTimeout(refreshTimer.current);
    refreshTimer.current = setTimeout(() => void refresh(), 500);
  }, [isToday, refresh]);

  const realtimeStatus = usePostgresSubscription(
    `orders-${projectId}`,
    [{ table: 'orders', handler: onOrdersEvent }],
    true
  );

  // The poll now follows the hook's status: fast while the channel is not live, gone once it is.
  const realtimeOffline = realtimeStatus === 'error';

  useEffect(() => {
    if (realtimeStatus === 'live') return;
    const poll = setInterval(() => {
      if (isToday) void refresh();
    }, 15_000);
    return () => clearInterval(poll);
  }, [realtimeStatus, isToday, refresh]);

  // A slow heartbeat regardless of socket health: a socket that connects and then stalls fires
  // neither CHANNEL_ERROR nor CLOSED, and this is what keeps the page from freezing in that case.
  useEffect(() => {
    const heartbeat = setInterval(() => {
      if (isToday) void refresh();
    }, 60_000);
    return () => {
      clearInterval(heartbeat);
      if (refreshTimer.current) clearTimeout(refreshTimer.current);
    };
  }, [isToday, refresh]);

  /** The rows the list renders — chip + search, then the chosen sort. */
  const filtered = useMemo(
    () => sortOrders(filterOrders(orders, { filter, query: deferredQuery }), sortBy),
    [orders, filter, deferredQuery, sortBy]
  );

  return {
    // data
    filtered,
    // header figures come from the full-day read, never the loaded page
    dayTotal: dayStats.total,
    counts: dayStats.counts,
    // paging
    hasMore,
    loadingMore,
    loadMore,
    refresh,
    // day selection
    dateKey,
    isToday,
    selectDate,
    selectDayOffset,
    // controls
    filter,
    setFilter,
    query,
    setQuery,
    sortBy,
    setSortBy,
    // connection
    realtimeOffline,
  };
}
