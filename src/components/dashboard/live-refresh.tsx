'use client';

// LiveRefresh — keeps a server-rendered dashboard page fresh WITHOUT a manual
// browser refresh.
//
// ROOT CAUSE this fixes (2026-09-25): src/app/dashboard/page.tsx is a pure
// server component with no realtime channel and no interval, so the home
// screen froze at whatever the DB held at page load — the merchant's only way
// to see a new order was to hit refresh. The Orders page has a channel, but
// its only fallback (30s poll) starts ONLY after a CHANNEL_ERROR/CLOSED
// callback: a socket that connects and then silently stalls leaves the page
// stale forever.
//
// Two independent safety nets, so neither can leave the screen stale:
//   1. Realtime postgres_changes on the orders table (no project_id filter —
//      the same proven pattern as use-kitchen-orders.ts: filter+RLS on one
//      column made realtime drop every event, RLS alone isolates tenants).
//   2. A slow heartbeat that refreshes REGARDLESS of socket health, so a
//      silently-hung connection can never freeze the page. 60s keeps it
//      cheap; the RSC render is the cost, and the dashboard is a small page.
//
// router.refresh() re-runs the server components and swaps the RSC payload,
// so every number on the page (KPIs, charts, recent orders, table occupancy)
// updates in one shot — no per-widget state duplication.

import { useEffect } from 'react';
import { useRouter } from 'next/navigation';
import { createClient } from '@/lib/supabase/client';
import { isForeignProjectRow, reportRealtimeLeak } from '@/lib/realtime-guard';

/** Heartbeat period. Slow by design: realtime normally beats it by ~1s. */
const HEARTBEAT_MS = 60_000;

export function LiveRefresh({ projectId }: { projectId: string }) {
  const router = useRouter();

  useEffect(() => {
    const supabase = createClient();

    // Trailing 500ms debounce: order creation is a transaction that touches
    // `orders` and `order_items` — several events can land in one burst and
    // each refresh() is a full server render, so collapse them.
    let debounce: ReturnType<typeof setTimeout> | null = null;
    const ping = (payload?: { new?: unknown }) => {
      // Defence in depth (audit T2 #5). The production probe proved Realtime honours RLS, so
      // this branch is unreachable - and if it ever runs, another tenant's order row is on
      // screen: that is an ERROR-level signal, never a redraw, and never rendered.
      if (isForeignProjectRow(payload, projectId)) {
        reportRealtimeLeak('dashboard live-refresh');
        return;
      }
      if (debounce) clearTimeout(debounce);
      debounce = setTimeout(() => router.refresh(), 500);
    };

    const channel = supabase
      .channel(`dashboard-${projectId}`)
      .on(
        'postgres_changes',
        { event: '*', schema: 'public', table: 'orders' },
        ping
      )
      .on(
        'postgres_changes',
        { event: '*', schema: 'public', table: 'order_items' },
        ping
      )
      .subscribe();

    // Safety net: runs even when the socket is fine. This is what guarantees
    // the "must refresh" symptom cannot come back via a silent stall.
    const heartbeat = setInterval(() => router.refresh(), HEARTBEAT_MS);

    return () => {
      if (debounce) clearTimeout(debounce);
      clearInterval(heartbeat);
      void supabase.removeChannel(channel);
    };
    // router is stable; re-subscribing on its identity would churn the channel.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [projectId]);

  return null;
}
