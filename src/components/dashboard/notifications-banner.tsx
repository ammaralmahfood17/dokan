import Link from 'next/link';

/**
 * The one place a missed order is expensive is the kitchen screen, so the prompt to enable the
 * alert channels lives here — not only in settings, where nobody looks during a shift.
 *
 * `pushDevices` is the signed-in user's own subscription count (RLS on push_subscriptions is
 * per-user), and `telegramLinked` is the project-level link count (members may read it). Both are
 * server facts passed down, so the banner adds no client round trip and cannot flash a wrong state.
 */
export function NotificationsBanner({
  telegramLinked,
  pushDevices,
}: {
  telegramLinked: boolean;
  pushDevices: number;
}) {
  const noTelegram = !telegramLinked;
  const noPush = pushDevices === 0;
  if (!noTelegram && !noPush) return null;

  const text =
    noTelegram && noPush
      ? 'إشعارات الطلبات غير مفعّلة — الطلبات الجديدة ما توصلك إذا كنت بعيد عن الشاشة.'
      : noTelegram
        ? 'تيليجرام غير مربوط — التنبيهات توصل لهذا الجهاز فقط، ولو توقف المتصفح تنقطع.'
        : 'إشعارات المتصفح غير مفعّلة — لو توقف هذا الجهاز ما توصلك الطلبات.';

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
    </div>
  );
}
