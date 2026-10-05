'use client';

import Link from 'next/link';
import { useRouter } from 'next/navigation';
import { useState } from 'react';
import { createClient } from '@/lib/supabase/client';
import { LogOut, ShieldCheck } from 'lucide-react';

/**
 * Super-admin top bar (client) — nav links + a real sign-out button.
 * The old layout was server-only with a <nav> but no way to log out,
 * which trapped the admin in the surface (no sidebar here, unlike the
 * tenant dashboard). Sign-out must clear the session cookie then reload
 * to /login.
 */
export function SuperAdminHeader() {
  const router = useRouter();
  const [loggingOut, setLoggingOut] = useState(false);

  async function handleLogout() {
    if (loggingOut) return;
    setLoggingOut(true);
    const supabase = createClient();
    await supabase.auth.signOut();
    // Same logout hygiene as the tenant sidebar: drop SW caches + unregister.
    const { purgeServiceWorkerState } = await import('@/lib/sw-purge');
    await purgeServiceWorkerState();
    router.push('/login');
    router.refresh();
  }

  return (
    <header className="sticky top-0 z-[var(--z-sticky)] border-b border-[var(--color-border)] bg-[var(--color-surface)]">
      <div className="flex items-center justify-between gap-2 px-4 py-3">
        <div className="flex min-w-0 items-center gap-3">
          <span className="flex h-8 w-8 shrink-0 items-center justify-center rounded-[var(--radius-md)] bg-[var(--color-danger)] text-xs font-bold text-white">
            <ShieldCheck className="h-4 w-4" />
          </span>
          <span className="truncate text-sm font-bold">لوحة التحكم الرئيسية</span>
        </div>

        {/* Nav — wraps on narrow screens instead of overflowing */}
        <nav className="flex min-w-0 flex-wrap items-center justify-end gap-1 text-xs font-semibold">
          <Link
            href="/super-admin/subscriptions"
            className="rounded-[var(--radius-md)] px-2.5 py-2 text-[var(--color-text-secondary)] transition-colors hover:bg-[var(--color-surface-sunken)] hover:text-[var(--color-text)]"
          >
            الاشتراكات
          </Link>
          <Link
            href="/super-admin/users"
            className="rounded-[var(--radius-md)] px-2.5 py-2 text-[var(--color-text-secondary)] transition-colors hover:bg-[var(--color-surface-sunken)] hover:text-[var(--color-text)]"
          >
            الحسابات
          </Link>
          <Link
            href="/super-admin/analytics"
            className="rounded-[var(--radius-md)] px-2.5 py-2 text-[var(--color-text-secondary)] transition-colors hover:bg-[var(--color-surface-sunken)] hover:text-[var(--color-text)]"
          >
            التحليلات
          </Link>
          <Link
            href="/super-admin/audit"
            className="rounded-[var(--radius-md)] px-2.5 py-2 text-[var(--color-text-secondary)] transition-colors hover:bg-[var(--color-surface-sunken)] hover:text-[var(--color-text)]"
          >
            سجل العمليات
          </Link>
          <button
            type="button"
            onClick={handleLogout}
            disabled={loggingOut}
            className="ms-1 flex min-h-[44px] items-center gap-1.5 rounded-[var(--radius-md)] px-3 py-2 text-[var(--color-danger)] transition-colors hover:bg-[var(--color-danger-tint)] disabled:opacity-50"
          >
            <LogOut className="h-3.5 w-3.5" />
            {loggingOut ? 'جاري…' : 'تسجيل الخروج'}
          </button>
        </nav>
      </div>
    </header>
  );
}
