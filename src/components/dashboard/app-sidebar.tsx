'use client';

import Link from 'next/link';
import { usePathname, useRouter } from 'next/navigation';
import { useEffect, useState } from 'react';
import {
  LayoutDashboard,
  Package,
  Boxes,
  ClipboardList,
  ChefHat,
  Monitor,
  QrCode,
  BarChart3,
  Settings,
  LogOut,
  Store,
  Menu,
  X,
} from 'lucide-react';
import { cn } from '@/lib/utils';
import { useFinePointer } from '@/lib/use-fine-pointer';
import { toast } from 'sonner';
import type { StaffRole } from '@/lib/types';

type NavItem = {
  href: string;
  label: string;
  shortLabel: string;
  icon: React.ComponentType<{ className?: string }>;
  roles?: readonly StaffRole[];
};

const NAV_MAIN: NavItem[] = [
  { href: '/dashboard', label: 'الرئيسية', shortLabel: 'الرئيسية', icon: LayoutDashboard },
  { href: '/dashboard/analytics', label: 'الإحصائيات', shortLabel: 'إحصائيات', icon: BarChart3, roles: ['owner', 'manager'] },
  { href: '/dashboard/products', label: 'المنتجات', shortLabel: 'منتجات', icon: Package, roles: ['owner', 'manager'] },
  { href: '/dashboard/inventory', label: 'المخزون', shortLabel: 'المخزون', icon: Boxes, roles: ['owner', 'manager'] },
  { href: '/dashboard/orders', label: 'الطلبات', shortLabel: 'طلبات', icon: ClipboardList },
  { href: '/dashboard/kitchen', label: 'شاشة المطبخ', shortLabel: 'مطبخ', icon: ChefHat },
  { href: '/dashboard/pos', label: 'نقطة البيع', shortLabel: 'POS', icon: Monitor },
  { href: '/dashboard/tables', label: 'الطاولات و QR', shortLabel: 'طاولات', icon: QrCode, roles: ['owner', 'manager'] },
];

const NAV_BOTTOM: NavItem[] = [
  { href: '/dashboard/settings', label: 'الإعدادات', shortLabel: 'إعدادات', icon: Settings, roles: ['owner'] },
];

/**
 * Bottom nav (phones only, <768). Four destinations a waiter switches between
 * dozens of times a shift, plus «المزيد» which opens the drawer with the rest.
 * Deliberately NOT derived from NAV_MAIN: the owner's first four entries are
 * analytics/products/inventory, while the floor staff needs orders/POS/kitchen.
 */
const NAV_BAR: NavItem[] = [
  { href: '/dashboard', label: 'الرئيسية', shortLabel: 'الرئيسية', icon: LayoutDashboard },
  { href: '/dashboard/orders', label: 'الطلبات', shortLabel: 'طلبات', icon: ClipboardList },
  { href: '/dashboard/pos', label: 'نقطة البيع', shortLabel: 'POS', icon: Monitor },
  { href: '/dashboard/kitchen', label: 'شاشة المطبخ', shortLabel: 'مطبخ', icon: ChefHat },
];

export function AppSidebar({
  projectName,
  role,
}: {
  projectName: string;
  role: StaffRole;
}) {
  const pathname = usePathname();
  const router = useRouter();
  const [isOpen, setIsOpen] = useState(false);
  // Prefetch is a desktop affordance: on a phone/tablet it spends the waiter's
  // data on routes they may never open.
  const canPrefetch = useFinePointer();

  useEffect(() => {
    if (!canPrefetch) return;
    if (role === 'owner') {
      try { router.prefetch('/dashboard/settings'); } catch {}
    }
    if (role !== 'staff') {
      try { router.prefetch('/dashboard/tables'); } catch {}
      try { router.prefetch('/dashboard/analytics'); } catch {}
    }
  }, [role, router, canPrefetch]);

  async function logout() {
    try {
      const { createClient, isBrowserSupportMode } = await import('@/lib/supabase/client');

      if (isBrowserSupportMode()) {
        const response = await fetch('/api/super-admin/impersonate/end', { method: 'POST' });
        if (response.status === 401) {
          // Marker already dead — the API cleared the support cookies. Leave support mode.
          window.location.assign('/login');
          return;
        }
        const result = await response.json();
        if (!response.ok || !result.ok) throw new Error('support session end failed');
        window.location.assign(
          result.restored ? '/super-admin/subscriptions' : '/login'
        );
        return;
      }

      const supabase = createClient();
      await supabase.auth.signOut();
      // Purge SW-cached pages/RSC so the next user of this device never gets
      // the previous session's data served from cache (iOS PWA has no
      // user-scoped storage isolation).
      const { purgeServiceWorkerState } = await import('@/lib/sw-purge');
      await purgeServiceWorkerState();
      router.push('/login');
      router.refresh();
    } catch {
      toast.error('تعذّر تسجيل الخروج — حاول مرة أخرى');
    }
  }

  function isActive(href: string) {
    if (href === '/dashboard') return pathname === '/dashboard';
    return pathname.startsWith(href);
  }

  function navItem(item: NavItem) {
    const active = isActive(item.href);
    const Icon = item.icon;
    return (
      <Link
        key={item.href}
        href={item.href}
        prefetch={canPrefetch}
        onClick={() => setIsOpen(false)}
        aria-current={active ? 'page' : undefined}
        className={cn(
          'group flex items-center gap-3 rounded-[10px] px-3 py-2.5 text-[13px] font-semibold transition-all duration-[var(--motion-fast)]',
          // Tablet (768–1023): 88px icon rail — icon above a 11.5px label, so
          // the Arabic label is visible without a 270px drawer eating the
          // counter screen. Back to a row at 1024.
          'md:flex-col md:gap-1 md:px-1 md:py-2 md:text-caption md:leading-tight md:text-center',
          'lg:flex-row lg:gap-3 lg:px-3 lg:py-2 lg:text-[13px]',
          active
            ? 'text-[var(--color-primary)]'
            : 'text-[var(--color-text-secondary)] hover:bg-[var(--color-bg)] hover:text-[var(--color-text)]'
        )}
      >
        <div className={cn(
          'flex h-7 w-7 shrink-0 items-center justify-center rounded-[var(--radius-md)] transition-all duration-[var(--motion-fast)]',
          'md:h-9 md:w-9 lg:h-7 lg:w-7',
          active
            ? 'bg-[var(--color-primary-tint-strong)] text-[var(--color-primary)]'
            : 'bg-transparent text-[var(--color-text-muted)] group-hover:text-[var(--color-text)]'
        )}>
          <Icon className={cn('h-4 w-4 md:h-5 md:w-5 lg:h-4 lg:w-4', active ? 'text-[var(--color-primary)]' : '')} />
        </div>
        <span className="md:max-w-full md:truncate">{item.label}</span>
        {active && (
          <div className="ms-auto h-1.5 w-1.5 rounded-full bg-[var(--color-primary)] md:hidden lg:block" />
        )}
      </Link>
    );
  }

  return (
    <>
      {/* The floating hamburger is gone on phones: the bottom nav below is the
          entry point, and «المزيد» opens this drawer. On a tablet (768–1023)
          the sidebar is a permanent 88px rail, so there is nothing to open. */}

      {/* Backdrop — phones only; the rail is static at 768+ */}
      {isOpen && (
        <div
          className="fixed inset-0 z-[var(--z-drawer)] bg-black/50 backdrop-blur-sm md:hidden animate-fade-in"
          /* audit T1 #20: a backdrop is not a control; the drawer's own close button is. */
          role="presentation"
          onClick={() => setIsOpen(false)}
          onKeyDown={(e) => { if (e.key === 'Escape') setIsOpen(false); }}
        />
      )}

      {/* Sidebar — z-drawer stays BELOW Modal/Sheet z-modal (300 < 500) so it never overlaps
          a modal backdrop on mobile or intercepts its backdrop-click-to-close. */}
      <aside
        className={cn(
          'fixed start-0 top-0 z-[var(--z-drawer)] flex h-dvh w-[270px] flex-col border-e border-[var(--color-border)] bg-[var(--color-surface)] transition-transform duration-[var(--motion-modal)]',
          isOpen ? 'translate-x-0' : 'translate-x-full',
          // 768–1023: a permanent 88px icon rail (a drawer would cost the
          // cashier a tap on every switch); 1024+: the familiar 224px sidebar.
          // Sticky at md+: a long products list must not scroll the nav (and
          // the logout row) out of reach — that was the behaviour with
          // `md:h-auto`, measured on a 20-card page.
          'md:sticky md:top-0 md:z-auto md:h-dvh md:w-[88px] md:translate-x-0 md:self-start md:shadow-none',
          'lg:w-56',
          'print:hidden'
        )}
      >
        {/* Header */}
        <div className="flex items-center justify-between border-b border-[var(--color-border)] px-3 py-3 md:justify-center md:px-2 md:py-4 lg:justify-between lg:px-4">
          <div className="flex items-center gap-2.5">
            <div className="flex h-9 w-9 items-center justify-center rounded-[10px] bg-[var(--color-primary)] text-white md:h-10 md:w-10 lg:h-9 lg:w-9">
              <Store className="h-4 w-4" />
            </div>
            <div className="min-w-0 md:hidden lg:block">
              <div className="truncate text-sm font-bold text-[var(--color-text)]">
                {projectName}
              </div>
              <div className="flex items-center gap-1 text-caption text-[var(--color-text-muted)]">
                <span>دكان</span>
                <span className="h-1 w-1 rounded-full bg-[var(--color-text-muted)]" />
                <span>المطعم</span>
              </div>
            </div>
          </div>
          <button
            type="button"
            onClick={() => setIsOpen(false)}
            className="flex h-11 w-11 items-center justify-center rounded-[var(--radius-md)] hover:bg-[var(--color-bg)] md:hidden"
            aria-label="إغلاق"
          >
            <X className="h-4 w-4 text-[var(--color-text-muted)]" />
          </button>
        </div>

        {/* Navigation */}
        <nav className="flex-1 space-y-0.5 overflow-y-auto p-2 md:px-1.5 lg:p-2">
          {NAV_MAIN.filter((item) => !item.roles || item.roles.includes(role)).map(navItem)}
        </nav>

        {/* Bottom */}
        <div className="border-t border-[var(--color-border)] p-2 space-y-0.5 md:px-1.5 lg:p-2">
          {NAV_BOTTOM.filter((item) => !item.roles || item.roles.includes(role)).map(navItem)}

          {/* Logout */}
          <button
            type="button"
            onClick={logout}
            className="flex min-h-11 w-full items-center gap-3 rounded-[10px] px-3 py-2.5 text-[13px] font-semibold text-[var(--color-text-secondary)] hover:bg-[var(--color-danger-tint)] hover:text-[var(--color-danger)] transition-all duration-[var(--motion-fast)] md:min-h-0 md:flex-col md:gap-1 md:px-1 md:py-2 md:text-caption md:leading-tight md:text-center lg:min-h-0 lg:flex-row lg:gap-3 lg:px-3 lg:py-2 lg:text-[13px]"
          >
            <div className="flex h-7 w-7 shrink-0 items-center justify-center rounded-[var(--radius-md)] md:h-9 md:w-9 lg:h-7 lg:w-7">
              <LogOut className="h-4 w-4 md:h-5 md:w-5 lg:h-4 lg:w-4" />
            </div>
            <span className="md:hidden lg:inline lg:max-w-full lg:truncate">تسجيل الخروج</span>
            <span className="hidden md:inline lg:hidden">خروج</span>
          </button>
        </div>
      </aside>

      {/* Bottom nav — phones only. 56px + the home-indicator inset; the same
          destinations a waiter toggles between all shift, and «المزيد» opens the
          drawer holding products/tables/analytics/settings. */}
      <nav
        aria-label="التنقل السريع"
        className="fixed inset-x-0 bottom-0 z-[var(--z-sticky)] border-t border-[var(--color-border)] bg-[var(--color-surface)]/95 pb-[env(safe-area-inset-bottom)] backdrop-blur-md md:hidden print:hidden"
      >
        <ul className="flex h-14 items-stretch">
          {NAV_BAR.filter((item) => !item.roles || item.roles.includes(role)).map((item) => {
            const active = isActive(item.href);
            const Icon = item.icon;
            return (
              <li key={item.href} className="flex-1">
                <Link
                  href={item.href}
                  prefetch={false}
                  aria-current={active ? 'page' : undefined}
                  className={cn(
                    'flex h-14 w-full flex-col items-center justify-center gap-1 text-caption font-semibold',
                    active
                      ? 'text-[var(--color-primary)]'
                      : 'text-[var(--color-text-secondary)]'
                  )}
                >
                  <Icon className="h-5 w-5" aria-hidden="true" />
                  <span>{item.shortLabel}</span>
                </Link>
              </li>
            );
          })}
          <li className="flex-1">
            <button
              type="button"
              onClick={() => setIsOpen(true)}
              className="flex h-14 w-full flex-col items-center justify-center gap-1 text-caption font-semibold text-[var(--color-text-secondary)]"
            >
              <Menu className="h-5 w-5" aria-hidden="true" />
              <span>المزيد</span>
            </button>
          </li>
        </ul>
      </nav>
    </>
  );
}
