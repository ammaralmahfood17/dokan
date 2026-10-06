'use client';

// FIX-C-003: Kitchen board data layer — extracted verbatim from
// kitchen-client.tsx (audit item 2.4, pure move — no behavior change).
// Owns the orders board state, the realtime subscription, the 30s fallback
// poll, and the merge rules that keep realtime/poll snapshots from clobbering
// fresher rows. All explanatory notes below travel with the code unchanged.

import { useCallback, useEffect, useRef, useState } from 'react';
import { createClient } from '@/lib/supabase/client';
import type { OrderRow } from '@/lib/kitchen-tickets';
import { isForeignProjectRow, reportRealtimeLeak } from '@/lib/realtime-guard';

export function useKitchenOrders({
  projectId,
  initialOrders,
  notifyNewOrder,
}: {
  projectId: string;
  initialOrders: OrderRow[];
  notifyNewOrder: (orderNum: number) => void;
}) {
  const [orders, setOrders] = useState(initialOrders);
  const knownIds = useRef(new Set(initialOrders.map((o) => o.id)));
  // Ids added via realtime INSERT — fullRefresh must preserve them even if a
  // poll snapshot was taken before their commit (see fullRefresh merge).
  const realtimeAddedRef = useRef<Set<string>>(new Set());
  // Ids touched by a realtime UPDATE since the last poll — fullRefresh must
  // keep the fresher local row instead of letting an older snapshot win.
  const realtimeTouchedRef = useRef<Set<string>>(new Set());
  // M3: ids currently on our board. order_items has no project_id column and
  // Supabase realtime can't filter by a joined orders.project_id, so we
  // filter incoming order_items events client-side against this set — other
  // tenants' item changes are dropped without a fetch.
  const knownOrderIdsRef = useRef<Set<string>>(new Set());

  // Full refresh fallback
  const fullRefresh = useCallback(async () => {
    try {
      const supabase = createClient();
      // Paged loop (1000/page) — a plain limit(50) silently dropped the
      // OLDEST active tickets (the ones a cook needs most) on a busy shift.
      const PAGE = 1000;
      const rows: OrderRow[] = [];
      let from = 0;
      for (;;) {
        const { data } = await supabase
          .from('orders')
          .select('*, tables(number), order_items(*)')
          .eq('project_id', projectId)
          .in('status', ['pending', 'preparing', 'ready'])
          .is('service_type', null)
          .order('created_at', { ascending: true })
          .range(from, from + PAGE - 1);
        if (!data) return;
        rows.push(...(data as unknown as OrderRow[]));
        if (data.length < PAGE) break;
        from += PAGE;
      }

      // Oldest first (FIFO) — matches the server's initial query, so a poll
      // snapshot covers every open ticket, not just the first page.

      for (const o of rows) {
        if (!knownIds.current.has(o.id) && o.status === 'pending') {
          notifyNewOrder(o.order_number);
        }
        knownIds.current.add(o.id);
      }
      // Bound the dedupe set — drop ids of delivered/cancelled/old orders once
      // it grows too large (realtime ids are re-added on INSERT).
      if (knownIds.current.size > 300) {
        knownIds.current = new Set(rows.map((o) => o.id));
      }
      // Merge instead of wholesale replace: a ticket inserted via realtime
      // between this snapshot and its commit must not vanish from the board
      // just because the poll response arrived without it.
      setOrders((prev) => {
        const byId = new Map(rows.map((o) => [o.id, o]));
        for (const o of prev) {
          if (realtimeAddedRef.current.has(o.id) && !byId.has(o.id)) {
            byId.set(o.id, o);
          }
          // A realtime UPDATE may have landed after this snapshot was taken —
          // prefer the local row so the poll can't overwrite fresher state.
          const snap = byId.get(o.id);
          if (
            snap &&
            realtimeTouchedRef.current.has(o.id) &&
            (o.updated_at ?? '') >= (snap.updated_at ?? '')
          ) {
            byId.set(o.id, o);
          }
        }
        return [...byId.values()];
      });
      realtimeAddedRef.current.clear();
      realtimeTouchedRef.current.clear();
    } catch (err) {
      // Silently fail the refresh — keep the previous board state.
      console.error('fullRefresh failed', err);
    }
  }, [projectId, notifyNewOrder]);

  // Fetch single order
  const fetchSingleOrder = useCallback(
    async (orderId: string) => {
      const supabase = createClient();
      const { data } = await supabase
        .from('orders')
        .select('*, tables(number), order_items(*)')
        .eq('id', orderId)
        .eq('project_id', projectId)
        .single();
      return data as OrderRow | null;
    },
    [projectId]
  );

  // Realtime item updates from another screen — refetch that order so the
  // board stays in sync even when the change came from elsewhere.
  const refetchOrder = useCallback(
    async (orderId: string) => {
      const fresh = await fetchSingleOrder(orderId);
      if (!fresh) return;
      setOrders((prev) => {
        const exists = prev.some((o) => o.id === orderId);
        if (!exists) return prev;
        return prev.map((o) => (o.id === orderId ? fresh : o));
      });
    },
    [fetchSingleOrder]
  );

  // M3: keep the known-id set in sync with the board.
  useEffect(() => {
    knownOrderIdsRef.current = new Set(orders.map((o) => o.id));
  }, [orders]);

  // Realtime
  useEffect(() => {
    const supabase = createClient();

    // NOTE: no project_id filter on these channels. RLS (orders_staff_*
    // policies) already isolates events per tenant — verified live with a
    // probe: filter+RLS on the same column made realtime drop EVERY event,
    // so orders took up to 30s to appear (30s fallback poll). Without the
    // filter, events arrive in ~1s and cross-tenant events are still
    // blocked by RLS. See migration 0018 note.
    const itemRefetchTimers = new Map<string, ReturnType<typeof setTimeout>>();
    const channel = supabase
      .channel(`kds-${projectId}`)
      .on(
        'postgres_changes',
        { event: 'INSERT', schema: 'public', table: 'orders' },
        async (payload) => {
          // Audit T2 #5: never render another tenant's row. Unreachable while Realtime honours
          // RLS (proven by scripts/realtime-probe.ts on 2026-10-06) - hence the alarm.
          if (isForeignProjectRow(payload, projectId)) {
            reportRealtimeLeak('kitchen board (insert)');
            return;
          }
          const newOrder = payload.new as Partial<OrderRow>;
          const newId = newOrder.id as string;
          if (!newId || knownIds.current.has(newId)) return;
          if (newOrder.service_type) return;

          try {
            const fullOrder = await fetchSingleOrder(newId);
            if (!fullOrder) return;

            knownIds.current.add(newId);
            realtimeAddedRef.current.add(newId);
            notifyNewOrder(fullOrder.order_number);
            setOrders((prev) => [fullOrder, ...prev]);
          } catch (err) {
            // Keep the board as-is; the next poll will pick the order up.
            console.error('fetchSingleOrder failed', err);
          }
        }
      )
      .on(
        'postgres_changes',
        { event: 'UPDATE', schema: 'public', table: 'orders' },
        (payload) => {
          if (isForeignProjectRow(payload, projectId)) {
            reportRealtimeLeak('kitchen board (update)');
            return;
          }
          const updated = payload.new as Partial<OrderRow>;
          if (updated.id) realtimeTouchedRef.current.add(updated.id);
          setOrders((prev) => {
            if (updated.status === 'delivered' || updated.status === 'cancelled') {
              return prev.filter((o) => o.id !== updated.id);
            }
            return prev.map((o) => (o.id === updated.id ? { ...o, ...updated } : o));
          });
        }
      )
      .on(
        'postgres_changes',
        { event: 'DELETE', schema: 'public', table: 'orders' },
        (payload) => {
          // A DELETE payload carries only the key unless REPLICA IDENTITY is FULL, so this can
          // only judge when project_id is present - and dropping a foreign id from a local
          // list is harmless either way.
          if (isForeignProjectRow({ new: payload.old }, projectId)) {
            reportRealtimeLeak('kitchen board (delete)');
            return;
          }
          const deletedId = payload.old?.id as string;
          setOrders((prev) => prev.filter((o) => o.id !== deletedId));
        }
      )
      .on(
        'postgres_changes',
        { event: 'UPDATE', schema: 'public', table: 'order_items' },
        (payload) => {
          // Item moved by another screen — refetch that order to keep the
          // board correct. M3: order_items has no project_id and realtime
          // can't join-filter, so drop events for orders not on our board
          // before fetching — other tenants' updates are pure noise.
          const itemOrderId = (payload.new as { order_id: string }).order_id;
          if (!knownOrderIdsRef.current.has(itemOrderId)) return;
          // Trailing-debounce per order (500ms, orders-client pattern): a
          // burst of order_items UPDATEs (POS editing several lines) must
          // collapse into ONE refetch of that order.
          const pending = itemRefetchTimers.get(itemOrderId);
          if (pending) clearTimeout(pending);
          itemRefetchTimers.set(
            itemOrderId,
            setTimeout(() => {
              itemRefetchTimers.delete(itemOrderId);
              void refetchOrder(itemOrderId);
            }, 500)
          );
        }
      )
      .subscribe();

    // Fallback polling every 30s
    const interval = setInterval(() => void fullRefresh(), 30000);

    return () => {
      itemRefetchTimers.forEach((t) => clearTimeout(t));
      itemRefetchTimers.clear();
      void supabase.removeChannel(channel);
      clearInterval(interval);
    };
  }, [projectId, fullRefresh, fetchSingleOrder, notifyNewOrder, refetchOrder]);

  return { orders, setOrders, fullRefresh };
}
