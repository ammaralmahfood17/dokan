'use client';

// Live «طلب موظف / طلب فاتورة» feed for the kitchen board.
//
// The customer's menu buttons POST to /api/public/waiter|bill, which store a
// row in `service_requests` and push a notification. This hook is the staff
// side: it seeds from the server render, subscribes to INSERTs on the table,
// and exposes `resolve` (mark done) so the strip empties as staff handle them.
//
// Realtime follows the same rules as the orders board: the subscription opens
// only after the session token is on the socket (usePostgresSubscription), and
// every incoming row is checked against this project (realtime-guard) before it
// is allowed to render.

import { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import { createClient } from '@/lib/supabase/client';
import { usePostgresSubscription } from '@/lib/realtime/use-postgres-subscription';
import { isForeignProjectRow, reportRealtimeLeak } from '@/lib/realtime-guard';

export type ServiceRequestKind = 'waiter' | 'bill';

export type ServiceRequestRow = {
  id: string;
  type: ServiceRequestKind;
  created_at: string;
  table_id: string;
  tables?: { number: number } | null;
};

const SELECT = 'id,type,created_at,table_id,tables(number)';

export function useKitchenServiceRequests({
  projectId,
  initialRequests,
  onNewRequest,
}: {
  projectId: string;
  initialRequests: ServiceRequestRow[];
  /** Fired once per request that was not already on the board (chime/toast). */
  onNewRequest: (kind: ServiceRequestKind, tableNumber: number | null) => void;
}) {
  const [requests, setRequests] = useState<ServiceRequestRow[]>(initialRequests);
  const knownIds = useRef(new Set(initialRequests.map((r) => r.id)));
  // The callback is read through a ref so a parent re-render (a toast, a clock
  // tick) can never rebuild the realtime bindings and drop the socket.
  const onNewRequestRef = useRef(onNewRequest);
  useEffect(() => {
    onNewRequestRef.current = onNewRequest;
  });

  const refresh = useCallback(async () => {
    const supabase = createClient();
    const { data } = await supabase
      .from('service_requests')
      .select(SELECT)
      .eq('project_id', projectId)
      .eq('is_resolved', false)
      .order('created_at', { ascending: true });
    if (!data) return;
    const rows = data as unknown as ServiceRequestRow[];
    for (const r of rows) knownIds.current.add(r.id);
    setRequests(rows);
  }, [projectId]);

  const bindings = useMemo(
    () => [
      {
        table: 'service_requests',
        event: 'INSERT' as const,
        handler: async (payload: { new?: unknown }) => {
          if (isForeignProjectRow(payload, projectId)) {
            reportRealtimeLeak('kitchen service requests (insert)');
            return;
          }
          const id = (payload.new as { id?: string } | undefined)?.id;
          if (!id || knownIds.current.has(id)) return;
          knownIds.current.add(id);

          // The INSERT payload has no joined table number, so read the row back
          // with the join instead of guessing from the raw table_id.
          const supabase = createClient();
          const { data } = await supabase
            .from('service_requests')
            .select(SELECT)
            .eq('id', id)
            .single();
          if (!data) return;
          const row = data as unknown as ServiceRequestRow;
          setRequests((prev) => (prev.some((r) => r.id === id) ? prev : [...prev, row]));
          onNewRequestRef.current(row.type, row.tables?.number ?? null);
        },
      },
    ],
    [projectId]
  );

  const status = usePostgresSubscription(`kds-service-${projectId}`, bindings, true);

  // Fallback poll — fast until the socket is live, slow once it is (insurance,
  // not the path).
  useEffect(() => {
    const period = status === 'live' ? 120_000 : 15_000;
    const id = setInterval(() => void refresh(), period);
    return () => clearInterval(id);
  }, [refresh, status]);

  /** Mark a request handled. Optimistic: it leaves the strip immediately. */
  const resolve = useCallback(
    async (id: string) => {
      setRequests((prev) => prev.filter((r) => r.id !== id));
      const supabase = createClient();
      const { error } = await supabase
        .from('service_requests')
        .update({ is_resolved: true })
        .eq('id', id);
      // A failed write must not hide a request the staff still has to handle.
      if (error) void refresh();
    },
    [refresh]
  );

  return { requests, resolve, refresh, status };
}