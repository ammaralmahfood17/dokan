'use client';

// D7: Offline indicator — a slim banner instead of a full-screen block so
// the customer can still see the menu and their cart while offline.
// Listens to navigator.onLine events; disappears automatically on reconnect.
import { useSyncExternalStore } from 'react';
import { WifiOff } from 'lucide-react';

function subscribeToConnection(callback: () => void) {
  window.addEventListener('online', callback);
  window.addEventListener('offline', callback);
  return () => {
    window.removeEventListener('online', callback);
    window.removeEventListener('offline', callback);
  };
}

export function OfflineBanner() {
  const isOnline = useSyncExternalStore(
    subscribeToConnection,
    () => navigator.onLine,
    () => true
  );

  if (isOnline) return null;

  return (
    <div
      role="status"
      aria-live="polite"
      className="fixed inset-x-0 top-0 z-[var(--z-toast)] flex items-center justify-center gap-2 bg-[var(--color-danger)] px-4 py-2 text-[12.5px] font-bold text-white"
    >
      <WifiOff className="h-4 w-4" />
      أنت غير متصل — يمكنك متابعة التصفح وإرسال الطلب عند عودة الاتصال
    </div>
  );
}
