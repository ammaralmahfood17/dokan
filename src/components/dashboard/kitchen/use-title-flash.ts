'use client';

// FIX-C-003: Page title flashing — extracted verbatim from kitchen-client.tsx
// (audit item 2.4, pure move — no behavior change). Ref-based timers tied to
// the component lifetime; see KDS audio singleton rule.
import { useCallback, useEffect, useRef } from 'react';

export function useTitleFlash() {
  const originalTitleRef = useRef('');
  const flashIntervalRef = useRef<ReturnType<typeof setInterval> | null>(null);
  const stopTimeoutRef = useRef<ReturnType<typeof setTimeout> | null>(null);

  const stopFlash = useCallback(() => {
    if (stopTimeoutRef.current) {
      clearTimeout(stopTimeoutRef.current);
      stopTimeoutRef.current = null;
    }
    if (flashIntervalRef.current) {
      clearInterval(flashIntervalRef.current);
      flashIntervalRef.current = null;
    }
    if (originalTitleRef.current) document.title = originalTitleRef.current;
  }, []);

  const flashTitle = useCallback(
    (count: number) => {
      if (!originalTitleRef.current) originalTitleRef.current = document.title;
      // Cancel any in-flight flash first — otherwise the OLD 10s timeout
      // would fire mid-new-flash, kill the new interval and restore the
      // title early.
      stopFlash();

      // audit T1 #18: a 1 Hz document.title swap is motion the CSS kill-switch cannot reach (it
      // is JS), and it fires exactly when nobody is looking - a hidden tab. Reduced motion gets a
      // single, steady marker instead of a flash; a visible tab still alternates.
      if (window.matchMedia('(prefers-reduced-motion: reduce)').matches) {
        document.title = `🔔 ${count} طلب جديد | ${originalTitleRef.current}`;
        return;
      }

      let showAlert = true;
      flashIntervalRef.current = setInterval(() => {
        if (document.hidden) return; // no work while nobody is looking
        document.title = showAlert
          ? `🔔 ${count} طلب جديد | ${originalTitleRef.current}`
          : originalTitleRef.current;
        showAlert = !showAlert;
      }, 1000);

      stopTimeoutRef.current = setTimeout(stopFlash, 10000);
    },
    [stopFlash]
  );

  const clearFlash = useCallback(() => {
    stopFlash();
  }, [stopFlash]);

  const syncTitle = useCallback(() => {
    originalTitleRef.current = document.title;
  }, []);

  const resetTitle = useCallback(() => {
    stopFlash();
    originalTitleRef.current = '';
  }, [stopFlash]);

  // Never survive the component: a late timeout firing after unmount would
  // clobber the next page's title.
  useEffect(() => {
    return () => {
      stopFlash();
      originalTitleRef.current = '';
    };
  }, [stopFlash]);

  return { flashTitle, clearFlash, syncTitle, resetTitle };
}
