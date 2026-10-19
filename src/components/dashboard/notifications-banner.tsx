'use client';

import Link from 'next/link';
import { useSyncExternalStore } from 'react';

/**
 * The one place a missed order is expensive is the kitchen screen, so the prompt to enable the
 * alert channels lives here — not only in settings, where nobody looks during a shift.
 *
 * `pushDevices` is the signed-in user's own subscription count (RLS on push_subscriptions is
 * per-user), and `telegramLinked` is the project-level link count (members may read it). Both are
 * server facts passed down, so the banner adds no client round trip and cannot flash a wrong state.
 *
 * Dismissible (2026-10-19): it occupied a quarter of a 375px kitchen screen and could only be
 * removed by configuring a channel, so a cook who already works with sound lost that space on
 * every shift. The dismissal lasts for the browser session, then the reminder returns.
 */
const DISMISS_KEY = 'dokan:notif-banner-dismissed';

// A tiny external store instead of useEffect+setState: the value lives in sessionStorage,
// which does not exist on the server, and useSyncExternalStore is the one hook that reads
// it after hydration without a hydration mismatch or a setState-in-effect.
const listeners = new Set<() => void>();
function subscribe(listener: () => void) {
  listeners.add(listener);
  return () => listeners.delete(listener);
}
function getSnapshot() {
  try {
    return sessionStorage.getItem(DISMISS_KEY) === '1';
  } catch {
    return false;
  }
}
const getServerSnapshot = () => false;

export function NotificationsBanner({
  telegramLinked,
  pushDevices,
}: {
  telegramLinked: boolean;
  pushDevices: number;
}) {
  const dismissed = useSyncExternalStore(subscribe, getSnapshot, getServerSnapshot);

  const noTelegram = !telegramLinked;
  const noPush = pushDevices === 0;
  if (dismissed || (!noTelegram && !noPush)) return null;

  const text =
    noTelegram && noPush
      ? 'إشعارات الطلبات غير مفعّلة — الطلبات الجديدة ما توصلك إذا كنت بعيد عن الشاشة.'
      : noTelegram
        ? 'تيليجرام غير مربوط — التنبيهات توصل لهذا الجهاز فقط، ولو توقف المتصفح تنقطع.'
        : 'إشعارات المتصفح غير مفعّلة — لو توقف هذا الجهاز ما توصلك الطلبات.';

  const dismiss = () => {
    try {
      sessionStorage.setItem(DISMISS_KEY, '1');
    } catch {
      // private mode / storage disabled — it simply stays visible
    }
    for (const listener of listeners) listener();
  };

  return (
    <div
      role="status"
      className="mx-5 mt-4 flex flex-wrap items-center gap-3 rounded-[var(--radius-md)] border border-[var(--color-warn)] bg-[var(--color-warn-tint)] px-4 py-3"
    >
      <span
        aria-hidden="true"
        className="flex h-5 w-5 shrink-0 items-center justify-center rounded-full bg-[var(--color-warn)] text-[12px] font-bold text-white"
      >
        !
      </span>
      <p className="min-w-0 flex-1 text-[13px] font-semibold leading-6 text-[var(--color-warn)]">
        {text}
      </p>
      <Link
        href="/dashboard/settings"
        className="inline-flex min-h-[44px] shrink-0 items-center rounded-[var(--radius-md)] bg-[var(--color-warn)] px-4 text-[12.5px] font-bold text-white transition-opacity hover:opacity-90"
      >
        تفعيل الإشعارات
      </Link>
      <button
        type="button"
        onClick={dismiss}
        aria-label="إغلاق التنبيه"
        className="flex h-[44px] w-[44px] shrink-0 items-center justify-center rounded-[var(--radius-md)] text-[18px] font-bold text-[var(--color-warn)] transition-colors hover:bg-[var(--color-warn)]/10"
      >
        ×
      </button>
    </div>
  );
}
