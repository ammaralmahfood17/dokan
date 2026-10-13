'use client';

import { useEffect } from 'react';

/**
 * Lock the page behind a modal / sheet / picker, and restore the exact scroll
 * position on release.
 *
 * This block was copied into `ui/modal.tsx`, `menu/sheet.tsx` and
 * `pos/pos-client.tsx`. The technique is the only one that survives iOS Safari —
 * `overflow: hidden` alone still lets the page rubber-band under the overlay —
 * so it is worth having one implementation that cannot drift:
 *   - `position: fixed` on <body> freezes the page (the browser drops scroll)
 *   - a negative `top` re-applies the offset the fixed body just lost
 *   - `overflowY: 'scroll'` keeps the scrollbar gutter, so the page behind the
 *     dialog does not reflow sideways when the lock engages
 *
 * Returns the release function, so a caller may unlock before unmount.
 */
export function lockBodyScroll(): () => void {
  if (typeof window === 'undefined') return () => {};

  const scrollY = window.scrollY;
  document.body.style.position = 'fixed';
  document.body.style.top = `-${scrollY}px`;
  document.body.style.width = '100%';
  document.body.style.overflowY = 'scroll';

  return () => {
    document.body.style.position = '';
    document.body.style.top = '';
    document.body.style.width = '';
    document.body.style.overflowY = '';
    window.scrollTo(0, scrollY);
  };
}

/** Effect-shaped wrapper: locks while mounted (and `enabled`). */
export function useBodyScrollLock(enabled = true): void {
  useEffect(() => {
    if (!enabled) return;
    return lockBodyScroll();
  }, [enabled]);
}
