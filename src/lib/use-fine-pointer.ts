'use client';

import { useSyncExternalStore } from 'react';

/**
 * `true` only on a precise pointer (mouse/trackpad). Used to gate prefetching:
 * on a phone or a counter tablet every prefetched route is bytes the waiter's
 * connection paid for and nobody asked for.
 *
 * Server snapshot is `false` — a prefetch hint has no meaning in SSR markup, and
 * returning `true` there would make the first client render disagree.
 */
const QUERY = '(pointer: fine)';

function subscribe(onChange: () => void) {
  const mql = window.matchMedia(QUERY);
  mql.addEventListener('change', onChange);
  return () => mql.removeEventListener('change', onChange);
}

export function useFinePointer(): boolean {
  return useSyncExternalStore(
    subscribe,
    () => window.matchMedia(QUERY).matches,
    () => false
  );
}
