'use client';

import { useEffect } from 'react';

/**
 * Keep a KDS/tablet screen awake while the board is open.
 *
 * WHY: a kitchen tablet dims and locks on its own timer, and the cook then misses the
 * chime/visual for a new order until someone touches it again. `navigator.wakeLock` is
 * supported in Chrome/Edge/Safari 16.4+; the API releases the sentinel automatically when
 * the tab is hidden, so it must be re-requested on `visibilitychange`.
 *
 * No-ops where the API is absent (older iOS, desktop Firefox) — it must never throw and
 * take the board down with it.
 */
export function useWakeLock(active = true) {
  useEffect(() => {
    if (!active) return;
    if (typeof navigator === 'undefined' || !('wakeLock' in navigator)) return;

    let sentinel: WakeLockSentinel | null = null;
    let stopped = false;

    const request = async () => {
      if (stopped || document.visibilityState !== 'visible') return;
      try {
        sentinel = await navigator.wakeLock.request('screen');
      } catch {
        // NotAllowedError (low battery / permission policy) — the screen simply sleeps.
      }
    };

    const onVisibility = () => {
      if (document.visibilityState === 'visible' && sentinel?.released !== false) {
        void request();
      }
    };

    void request();
    document.addEventListener('visibilitychange', onVisibility);

    return () => {
      stopped = true;
      document.removeEventListener('visibilitychange', onVisibility);
      void sentinel?.release().catch(() => {});
      sentinel = null;
    };
  }, [active]);
}
