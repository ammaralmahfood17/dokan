'use client';

import { useEffect } from 'react';
import { toast } from 'sonner';
import {
  isPendingOrderSyncMessage,
  PENDING_ORDER_EVENT,
} from '@/lib/pwa-events';

/**
 * Registers the Service Worker on first app load (any page — public menu or dashboard).
 *
 * M6: sw.js now calls skipWaiting() on install so a new version takes over as
 * soon as it's ready (no need to close all tabs). To avoid a disruptive
 * mid-order reload, we never reload automatically — instead we watch for
 * `controllerchange` (the new SW took over) and surface a toast asking the
 * user to reload when convenient.
 */
export function ServiceWorkerRegister() {
  useEffect(() => {
    if (!('serviceWorker' in navigator)) return;

    const showUpdateToast = () => {
      toast('🔄 تحديث متوفر', {
        description: 'نسخة جديدة من دكان جاهزة — أعد تحميل الصفحة للاستخدام',
        // top-center it is. F5 moved this to bottom-center to clear the header,
        // but on a phone the bottom of the viewport is where the money is: the
        // cart sheet's «تأكيد الطلب» and the POS checkout button both sit in
        // their footer, so the toast landed ON them and swallowed taps for the
        // full 8s after every deploy (caught by pos-path: "element is visible,
        // enabled and stable" followed by the click never landing). A toast
        // that blocks a customer from paying is worse than one that covers
        // navigation, and this is also the app-wide Toaster position.
        position: 'top-center',
        duration: 8000,
        id: 'sw-update',
        action: {
          label: 'إعادة تحميل',
          onClick: () => window.location.reload(),
        },
      });
    };

    // New SW took control (skipWaiting fired) — prompt, don't auto-reload.
    navigator.serviceWorker.addEventListener('controllerchange', showUpdateToast);

    const handleMessage = (event: MessageEvent<unknown>) => {
      if (!isPendingOrderSyncMessage(event.data)) return;

      window.dispatchEvent(
        new CustomEvent(PENDING_ORDER_EVENT, { detail: event.data })
      );
      if (event.data.type === 'PENDING_ORDER_SUBMITTED') {
        toast.success('تم إرسال الطلب المؤجل بنجاح');
      } else {
        toast.error(event.data.error);
      }
    };
    navigator.serviceWorker.addEventListener('message', handleMessage);

    navigator.serviceWorker
      .register('/sw.js')
      .catch(() => {}); // silent — PWA is progressive enhancement

    return () => {
      navigator.serviceWorker.removeEventListener('controllerchange', showUpdateToast);
      navigator.serviceWorker.removeEventListener('message', handleMessage);
    };
  }, []);

  return null;
}
