'use client';

import { useSyncExternalStore } from 'react';

/**
 * `navigator.onLine` as a React value.
 *
 * The kitchen screen used to print a hard-coded green dot and «متصل مباشر»
 * whatever the connection was doing (audit 2026-10-22): the board could stop
 * receiving orders and still claim to be live. `navigator.onLine` is not a
 * latency probe — it only knows whether an interface is up — but it is the one
 * signal that flips instantly and correctly on the failure we care about
 * (Wi-Fi dropped at the counter), and it is the same signal OfflineBanner uses,
 * so the dot and the banner can never disagree.
 */
function subscribe(callback: () => void) {
  window.addEventListener('online', callback);
  window.addEventListener('offline', callback);
  return () => {
    window.removeEventListener('online', callback);
    window.removeEventListener('offline', callback);
  };
}

export function useOnline(): boolean {
  return useSyncExternalStore(
    subscribe,
    () => navigator.onLine,
    // Server render: assume online so the board is not painted as broken
    // before hydration; the real value lands on the first client render.
    () => true
  );
}
