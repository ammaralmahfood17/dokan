import { redirect } from 'next/navigation';
import { cookies } from 'next/headers';
import { getCurrentProject } from '@/lib/project';
import { AppSidebar } from '@/components/dashboard/app-sidebar';
import { ImpersonationBanner } from '@/components/impersonation-banner';
import { OfflineBanner } from '@/components/ui/offline-banner';
import { getImpersonationById } from '@/lib/super-admin';

/** F-18: rendered per request so the proxy's CSP nonce reaches this page. */
export const dynamic = 'force-dynamic';

export default async function DashboardLayout({
  children,
}: {
  children: React.ReactNode;
}) {
  // Check support mode before touching tenant data. Once the short-lived JWT
  // expires, authenticated queries fail; the admin still needs this recovery
  // screen to restore their original session.
  const cookieStore = await cookies();
  const impSessionId = cookieStore.get('dokan-impersonation')?.value ?? '';
  let impersonation: { targetEmail: string; expiresAt: string; expired: boolean } | null = null;
  if (impSessionId) {
    const supportSession = await getImpersonationById(impSessionId);
    if (supportSession) {
      impersonation = {
        targetEmail: supportSession.targetEmail,
        expiresAt: supportSession.expiresAt,
        expired: supportSession.expired,
      };
    } else {
      impersonation = { targetEmail: '', expiresAt: '', expired: true };
    }
  }

  if (impersonation?.expired) {
    return (
      <div className="min-h-dvh bg-[var(--color-bg)]">
        <ImpersonationBanner targetEmail="" expiresAt="" expired />
      </div>
    );
  }

  const ctx = await getCurrentProject();

  if (!ctx) {
    redirect('/onboarding');
  }

  // Subscription warning banner (7-day grace). Runs server-side so it shows
  // for every staff member without extra data fetching. Null expiry = perpetual.
  let expiryWarn = '';
  const daysLeft = ctx.subscriptionDaysLeft;
  if (daysLeft !== null && daysLeft <= 7) {
    expiryWarn =
      daysLeft <= 0
        ? 'انتهى الاشتراك — تواصل مع إدارة دكان للتجديد.'
        : `ينتهي الاشتراك خلال ${daysLeft} ${daysLeft === 1 ? 'يوم واحد' : 'أيام'} — جدّد قبل انقطاع الخدمة.`;
  }

  return (
    /* Column first: the support banner is a SIBLING of the sidebar+content row, never a
       flex child of it. As a row child it stretched to the full document height and
       painted the whole dashboard red (measured 1466px tall on a 1466px page). */
    <div className="flex min-h-dvh flex-col bg-[var(--color-bg)]">
      {/* Phase C: persistent support-mode banner (top of every dashboard page) */}
      {impersonation && (
        <ImpersonationBanner
          targetEmail={impersonation.targetEmail}
          expiresAt={impersonation.expiresAt}
          expired={impersonation.expired}
        />
      )}

      <div className="flex min-h-0 flex-1">
        {/* Sidebar */}
        <AppSidebar
          projectName={ctx.project.name}
          role={ctx.membership.role}
        />

        {/* Content */}
        <div className="flex min-w-0 flex-1 flex-col">
        {/* Mobile header */}
        <header className="sticky top-0 z-[var(--z-sticky)] flex items-center justify-between border-b border-[var(--color-border)] bg-[var(--color-surface)]/95 backdrop-blur-md px-4 py-3 lg:hidden print:hidden">
          <div className="flex items-center gap-2.5">
            <div className="flex h-8 w-8 items-center justify-center rounded-[var(--radius-md)] bg-[var(--color-primary)] text-xs font-bold text-white">
              {ctx.project.name.slice(0, 1)}
            </div>
            <span className="text-sm font-bold text-[var(--color-text)]">
              {ctx.project.name}
            </span>
          </div>
          <span className="text-[11.5px] font-medium text-[var(--color-text-secondary)]">
            دكان
          </span>
        </header>

        {expiryWarn && (
          <div className="border-b border-[var(--color-danger)]/20 bg-[var(--color-danger-tint)] px-4 py-2.5 text-center text-xs font-semibold text-[var(--color-danger)]">
            {expiryWarn}
          </div>
        )}

        {/* Merchant-side connection state: the kitchen claimed «متصل مباشر»
            with no connection check until the 2026-10-22 audit, and this banner
            existed only on the customer menu. Bottom placement so it cannot
            cover the support-mode bar. */}
        <OfflineBanner placement="bottom" aboveNav />

        {/* Main */}
        <main className="flex-1 pb-bottom-nav">
          <div>
            {children}
          </div>
        </main>
        </div>
      </div>
    </div>
  );
}
