'use client';

import { useEffect, useState } from 'react';
import { toast } from 'sonner';
import { useRouter } from 'next/navigation';

/**
 * Persistent support-mode banner. Rendered by the dashboard layout while an
 * impersonation session is active. One-click end: the API authenticates via
 * the httpOnly marker cookie, restores the super admin's session server-side
 * (tokens never transit JS since 2026-09-20 hardening) and clears the
 * marker; we just reload out of the target's dashboard.
 *
 * The marker cookie is read server-side by the layout; this component only
 * receives the display data.
 */
export function ImpersonationBanner({
  targetEmail,
  expiresAt,
  expired = false,
}: {
  targetEmail: string;
  expiresAt: string;
  expired?: boolean;
}) {
  const router = useRouter();
  const [ending, setEnding] = useState(false);
  const [now, setNow] = useState(() => Date.now());

  useEffect(() => {
    const t = setInterval(() => setNow(Date.now()), 30_000);
    return () => clearInterval(t);
  }, []);

  const minsLeft = Math.max(0, Math.ceil((new Date(expiresAt).getTime() - now) / 60000));

  async function end() {
    if (ending) return;
    setEnding(true);
    try {
      // No sessionId in the body — the httpOnly marker cookie authenticates
      // this browser as the one that started the impersonation.
      const res = await fetch('/api/super-admin/impersonate/end', { method: 'POST' });
      const data = await res.json();
      if (res.status === 401) {
        // The marker was already invalid/consumed; the API cleared the support cookies, so a
        // reload is the way out. Without this the banner stayed and every click re-toasted.
        window.location.assign('/login');
        return;
      }
      if (!res.ok || !data.ok) {
        toast.error(data.error || 'فشل إنهاء الجلسة');
        setEnding(false);
        return;
      }
      if (!data.restored) {
        toast('انتهت جلسة الدعم — سجّل دخولك من جديد');
      }
      // Auth cookies were already swapped server-side; leave the target's
      // dashboard for the super-admin area and refresh.
      router.push('/super-admin/subscriptions');
      router.refresh();
    } catch {
      toast.error('ما قدرت ننهي الجلسة — حاول مرة ثانية');
      setEnding(false);
    }
  }

  return (
    <div className="sticky top-0 z-[var(--z-toast)] w-full border-b border-[var(--color-danger)]/30 bg-[var(--color-danger)] px-4 py-2.5 text-white">
      <div className="mx-auto flex max-w-5xl flex-wrap items-center justify-between gap-2">
        <p className="text-xs font-bold">
          ⚠️ {expired ? (
            <>انتهت مدة جلسة الدعم الفني — استعد جلستك</>
          ) : (
            <>
              وضع الدعم الفني — تسجّل دخول باسم{' '}
              <span className="underline underline-offset-2" dir="ltr">
                {targetEmail}
              </span>
              <span className="ms-2 font-medium opacity-90">
                ({minsLeft > 0 ? `متبقي ${minsLeft} دقيقة` : 'تنتهي الآن'})
              </span>
            </>
          )}
        </p>
        <button
          type="button"
          onClick={end}
          disabled={ending}
          className="rounded-[var(--radius-md)] bg-white px-3 py-1.5 text-xs font-bold text-[var(--color-danger)] transition-opacity hover:opacity-90 disabled:opacity-50"
        >
          {ending ? 'جاري الإنتهاء…' : 'إنهاء الجلسة'}
        </button>
      </div>
    </div>
  );
}
