import { redirect } from 'next/navigation';
import { requireSuperAdmin } from '@/lib/super-admin';
import { SuperAdminHeader } from './super-admin-header';

/** F-18: rendered per request so the proxy's CSP nonce reaches this page. */
export const dynamic = 'force-dynamic';

/**
 * Super-admin route group guard. Runs on EVERY request (server component
 * layout) — a session that was valid at page load does not carry over; each
 * navigation re-checks membership in super_admins.
 *
 * No link to this surface exists anywhere in the regular dashboard — direct
 * URL only.
 */
export default async function SuperAdminLayout({
  children,
}: {
  children: React.ReactNode;
}) {
  await requireSuperAdmin();

  return (
    <div className="flex min-h-dvh flex-col bg-[var(--color-bg)]">
      {/* Top bar — client component: nav + sign-out (mobile-safe, wraps) */}
      <SuperAdminHeader />

      <main className="mx-auto w-full max-w-5xl flex-1 px-4 py-6">
        {children}
      </main>
    </div>
  );
}
