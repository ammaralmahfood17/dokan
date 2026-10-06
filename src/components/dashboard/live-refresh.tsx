'use client';

// LiveRefresh — keeps a server-rendered dashboard page fresh WITHOUT a manual browser refresh.
//
// Measured 2026-10-06 (this is why the file looks like this):
//   * Realtime itself is fine: a subscriber that signs in BEFORE subscribing receives an order in
//     137-365 ms, and RLS isolates tenants (0 rows for a project the user is not in).
//   * The app was not: every subscription site opened its channel on mount without pushing the
//     session to the Realtime socket, so the subscription was authorized as `anon`, RLS matched
//     nothing, and no event arrived - while the channel still reported SUBSCRIBED. Measured on the
//     kitchen board: a new order appeared after 27,295 ms, i.e. the fallback poll.
//     The commentary that used to live here claimed realtime "beats the heartbeat by ~1s": it did
//     not, and a comment that contradicts the measurement is worse than no comment.
//
// So the contract is now: `usePostgresSubscription` resolves the session, pushes the token, and only
// then opens the channel. This component adds the one thing a socket can never promise - a
// heartbeat that refreshes regardless of socket health, so a silent stall cannot freeze the page.
// Once the channel reports `live`, that heartbeat can be slow (60s); while it is not, it is 15s.

import { useCallback, useEffect, useRef } from 'react';
import { useRouter } from 'next/navigation';
import { isForeignProjectRow, reportRealtimeLeak } from '@/lib/realtime-guard';
import { usePostgresSubscription } from '@/lib/realtime/use-postgres-subscription';

const HEARTBEAT_LIVE_MS = 60_000;
const HEARTBEAT_DEGRADED_MS = 15_000;

export function LiveRefresh({ projectId }: { projectId: string }) {
  const router = useRouter();
  const debounce = useRef<ReturnType<typeof setTimeout> | null>(null);

  // Trailing 500ms debounce: order creation touches `orders` and `order_items`, so several events
  // land in one burst and each refresh() is a full server render.
  const ping = useCallback(
    (payload?: { new?: unknown }) => {
      if (isForeignProjectRow(payload, projectId)) {
        reportRealtimeLeak('dashboard live-refresh');
        return;
      }
      if (debounce.current) clearTimeout(debounce.current);
      debounce.current = setTimeout(() => router.refresh(), 500);
    },
    [router, projectId]
  );

  const status = usePostgresSubscription(
    `dashboard-${projectId}`,
    [
      { table: 'orders', handler: ping },
      { table: 'order_items', handler: ping },
    ],
    true
  );

  useEffect(() => {
    const period = status === 'live' ? HEARTBEAT_LIVE_MS : HEARTBEAT_DEGRADED_MS;
    const id = setInterval(() => router.refresh(), period);
    return () => {
      clearInterval(id);
      if (debounce.current) clearTimeout(debounce.current);
    };
  }, [router, status]);

  return null;
}
