'use client';

// D7: Offline indicator — a slim banner instead of a full-screen block so
// the customer can still see the menu and their cart while offline.
// Listens to navigator.onLine events; disappears automatically on reconnect.
import { WifiOff } from 'lucide-react';
import { useOnline } from '@/components/ui/use-online';

export function OfflineBanner({ placement = 'top' }: { placement?: 'top' | 'bottom' } = {}) {
  const isOnline = useOnline();

  if (isOnline) return null;

  return (
    <div
      role="status"
      aria-live="polite"
      className={`fixed inset-x-0 ${
        placement === 'top' ? 'top-0' : 'bottom-0 pb-safe-bottom'
      } z-[var(--z-toast)] flex items-center justify-center gap-2 bg-[var(--color-danger)] px-4 py-2 text-[12.5px] font-bold text-white`}
    >
      <WifiOff className="h-4 w-4" />
      أنت غير متصل — يمكنك متابعة التصفح وإرسال الطلب عند عودة الاتصال
    </div>
  );
}
