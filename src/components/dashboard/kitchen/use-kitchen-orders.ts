'use client';

// FIX-C-003: Kitchen board data layer — extracted verbatim from
// kitchen-client.tsx (audit item 2.4, pure move — no behavior change).
// Owns the orders board state, the realtime subscription, the 30s fallback
// poll, and the merge rules that keep realtime/poll snapshots from clobbering
// fresher rows. All explanatory notes below travel with the code unchanged.

import { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import { createClient } from '@/lib/supabase/client';
import type { OrderRow } from '@/lib/kitchen-tickets';
import { isForeignProjectRow, reportRealtimeLeak } from '@/lib/realtime-guard';
import { usePostgresSubscription } from '@/lib/realtime/use-postgres-subscription';

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
  // Per-order debounce for order_items bursts (survives re-renders, cleared on unmount)
  const itemRefetchTimers = useRef(new Map<string, ReturnType<typeof setTimeout>>());
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

  // Realtime. The channel opens only after the session token is on the socket — see
  // usePostgresSubscription for the measurement that made this necessary.
  const bindings = useMemo(
    () => [
      {
        table: 'orders',
        event: 'INSERT' as const,
        handler: async (payload: { new?: unknown }) => {
          if (isForeignProjectRow(payload, projectId)) {
            reportRealtimeLeak('kitchen board (insert)');
            return;
          }
          const newId = (payload.new as Partial<OrderRow>)?.id as string;
          if (!newId || knownIds.current.has(newId)) return;
          if ((payload.new as Partial<OrderRow>).service_type) return;
          try {
            const fullOrder = await fetchSingleOrder(newId);
            if (!fullOrder) return;
            knownIds.current.add(newId);
            realtimeAddedRef.current.add(newId);
            notifyNewOrder(fullOrder.order_number);
            setOrders((prev) => [fullOrder, ...prev]);
          } catch (err) {
            console.error('fetchSingleOrder failed', err);
          }
        },
      },
      {
        table: 'orders',
        event: 'UPDATE' as const,
        handler: (payload: { new?: unknown }) => {
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
        },
      },
      {
        table: 'orders',
        event: 'DELETE' as const,
        handler: (payload: { old?: unknown }) => {
          if (isForeignProjectRow({ new: (payload as { old?: unknown }).old }, projectId)) {
            reportRealtimeLeak('kitchen board (delete)');
            return;
          }
          const deletedId = (payload as { old?: { id?: string } }).old?.id;
          setOrders((prev) => prev.filter((o) => o.id !== deletedId));
        },
      },
      {
        table: 'order_items',
        event: 'UPDATE' as const,
        handler: (payload: { new?: unknown }) => {
          // order_items has no project_id: drop events for orders not on this board before fetching,
          // and collapse a burst of line updates into one refetch per order (500ms trailing).
          const itemOrderId = (payload.new as { order_id?: string })?.order_id;
          if (!itemOrderId || !knownOrderIdsRef.current.has(itemOrderId)) return;
          const pending = itemRefetchTimers.current.get(itemOrderId);
          if (pending) clearTimeout(pending);
          itemRefetchTimers.current.set(
            itemOrderId,
            setTimeout(() => {
              itemRefetchTimers.current.delete(itemOrderId);
              void refetchOrder(itemOrderId);
            }, 500)
          );
        },
      },
    ],
    [projectId, fetchSingleOrder, notifyNewOrder, refetchOrder]
  );

  const status = usePostgresSubscription(`kds-${projectId}`, bindings, true);

  useEffect(() => {
    const timers = itemRefetchTimers.current;
    return () => {
      timers.forEach((t) => clearTimeout(t));
      timers.clear();
    };
  }, []);

  // Fallback poll: fast while the socket is not live, slow once it is (a live channel makes it
  // insurance, not the path).
  useEffect(() => {
    const period = status === 'live' ? 120_000 : 15_000;
    const interval = setInterval(() => void fullRefresh(), period);
    return () => clearInterval(interval);
  }, [fullRefresh, status]);

  return { orders, setOrders, fullRefresh };
}
