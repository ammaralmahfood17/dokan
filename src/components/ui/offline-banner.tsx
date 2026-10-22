'use client';

// D7: Offline indicator — a slim banner instead of a full-screen block so
// the customer can still see the menu and their cart while offline.
// Listens to navigator.onLine events; disappears automatically on reconnect.
import { WifiOff } from 'lucide-react';
import { useOnline } from '@/components/ui/use-online';

export function OfflineBanner({
  placement = 'top',
  aboveNav = false,
}: {
  placement?: 'top' | 'bottom';
  /** Dashboard only: sit above the 56px phone bottom nav instead of under it. */
  aboveNav?: boolean;
} = {}) {
  const isOnline = useOnline();

  if (isOnline) return null;

  const bottomClass = aboveNav
    ? 'bottom-[calc(var(--bottom-nav-h)+env(safe-area-inset-bottom))] md:bottom-0'
    : 'bottom-0 pb-safe-bottom';

  return (
    <div
      role="status"
      aria-live="polite"
      className={`fixed inset-x-0 ${
        placement === 'top' ? 'top-0' : bottomClass
      } z-[var(--z-toast)] flex items-center justify-center gap-2 bg-[var(--color-danger)] px-4 py-2 text-[12.5px] font-bold text-white`}
    >
      <WifiOff className="h-4 w-4" />
      أنت غير متصل — يمكنك متابعة التصفح وإرسال الطلب عند عودة الاتصال
    </div>
  );
}
