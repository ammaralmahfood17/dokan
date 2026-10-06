'use client';

import { useEffect, useRef, useState } from 'react';
import type { RealtimePostgresChangesPayload } from '@supabase/supabase-js';
import { createClient } from '@/lib/supabase/client';

/**
 * Realtime, done in one place.
 *
 * Why this exists (measured, not assumed): the three subscription sites each opened a channel on
 * mount and never attached the session to the Realtime socket. With cookie-based SSR auth the
 * token reaches the socket asynchronously - often after the channel has already been created - so
 * the subscription was authorized as `anon`, RLS matched no rows, and **no event ever arrived**
 * while the channel still reported SUBSCRIBED. Measured on the kitchen board: a new order took
 * **27,295 ms** to appear, i.e. the 30-second fallback poll, not realtime. A fresh client that
 * signs in before subscribing receives the same event in **137-365 ms**.
 *
 * So the order is: resolve the session, push the token with `realtime.setAuth`, and only then open
 * the channel. A rotated token is pushed too, and the subscription is rebuilt - an existing
 * `postgres_changes` subscription is not re-authorized in place.
 *
 * Handlers are read through a ref, so a re-render does not tear the socket down: only `topic` and
 * `enabled` are the channel's identity.
 */
export type PgBinding = {
  table: string;
  event?: '*' | 'INSERT' | 'UPDATE' | 'DELETE';
  handler: (payload: RealtimePostgresChangesPayload<Record<string, unknown>>) => void;
};

export type RealtimeStatus = 'connecting' | 'live' | 'error';

export function usePostgresSubscription(
  topic: string,
  bindings: PgBinding[],
  enabled = true
): RealtimeStatus {
  const [status, setStatus] = useState<RealtimeStatus>('connecting');
  const bindingsRef = useRef(bindings);
  // A ref may not be written during render (react-hooks/refs); the latest handlers go in an effect,
  // which also keeps a burst of re-renders from tearing the socket down.
  useEffect(() => {
    bindingsRef.current = bindings;
  }, [bindings]);

  useEffect(() => {
    if (!enabled) return;
    const supabase = createClient();
    let cancelled = false;
    let attempt = 0;
    let channel: ReturnType<typeof supabase.channel> | null = null;
    let retryTimer: ReturnType<typeof setTimeout> | null = null;
    let unsubscribeAuth: (() => void) | null = null;

    const open = () => {
      if (cancelled) return;
      const ch = supabase.channel(topic);
      for (const b of bindingsRef.current) {
        ch.on(
          'postgres_changes',
          { event: b.event ?? '*', schema: 'public', table: b.table },
          (payload) => bindingsRef.current.find((x) => x.table === b.table)?.handler(payload as never)
        );
      }
      channel = ch;
      ch.subscribe((s) => {
        if (cancelled) return;
        if (s === 'SUBSCRIBED') {
          attempt = 0;
          setStatus('live');
          return;
        }
        if (s === 'CHANNEL_ERROR' || s === 'TIMED_OUT' || s === 'CLOSED') {
          setStatus('error');
          attempt += 1;
          const delay = Math.min(1000 * 2 ** attempt, 30_000);
          retryTimer = setTimeout(() => {
            if (cancelled) return;
            const stale = channel;
            channel = null;
            if (stale) void supabase.removeChannel(stale);
            open();
          }, delay);
        }
      });
    };

    void (async () => {
      const { data } = await supabase.auth.getSession();
      if (cancelled) return;
      // THE FIX: the token must be on the socket before the channel exists.
      if (data.session?.access_token) supabase.realtime.setAuth(data.session.access_token);
      open();

      const { data: authSub } = supabase.auth.onAuthStateChange((event, session) => {
        if (!session?.access_token) return;
        supabase.realtime.setAuth(session.access_token);
        if (event === 'TOKEN_REFRESHED' || event === 'SIGNED_IN') {
          const stale = channel;
          channel = null;
          if (stale) void supabase.removeChannel(stale);
          open();
        }
      });
      unsubscribeAuth = () => authSub.subscription.unsubscribe();
    })();

    return () => {
      cancelled = true;
      if (retryTimer) clearTimeout(retryTimer);
      unsubscribeAuth?.();
      if (channel) void supabase.removeChannel(channel);
    };
  }, [topic, enabled]);

  return status;
}
