'use client';

import Link from 'next/link';
import { usePathname, useRouter } from 'next/navigation';
import { useEffect, useState } from 'react';
import {
  LayoutDashboard,
  Package,
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
  { href: '/dashboard/orders', label: 'الطلبات', shortLabel: 'طلبات', icon: ClipboardList },
  { href: '/dashboard/kitchen', label: 'شاشة المطبخ', shortLabel: 'مطبخ', icon: ChefHat },
  { href: '/dashboard/pos', label: 'نقطة البيع', shortLabel: 'POS', icon: Monitor },
  { href: '/dashboard/tables', label: 'الطاولات و QR', shortLabel: 'طاولات', icon: QrCode, roles: ['owner', 'manager'] },
];

const NAV_BOTTOM: NavItem[] = [
  { href: '/dashboard/settings', label: 'الإعدادات', shortLabel: 'إعدادات', icon: Settings, roles: ['owner'] },
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

  useEffect(() => {
    if (role === 'owner') {
      try { router.prefetch('/dashboard/settings'); } catch {}
    }
    if (role !== 'staff') {
      try { router.prefetch('/dashboard/tables'); } catch {}
      try { router.prefetch('/dashboard/analytics'); } catch {}
    }
  }, [role, router]);

  async function logout() {
    try {
      const { createClient, isBrowserSupportMode } = await import('@/lib/supabase/client');

      if (isBrowserSupportMode()) {
        const response = await fetch('/api/super-admin/impersonate/end', { method: 'POST' });
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
        prefetch={true}
        onClick={() => setIsOpen(false)}
        aria-current={active ? 'page' : undefined}
        className={cn(
          'group flex items-center gap-3 rounded-[10px] px-3 py-2.5 text-[13px] font-semibold transition-all duration-200',
          'lg:px-3 lg:py-2',
          active
            ? 'text-[var(--color-primary)]'
            : 'text-[var(--color-text-secondary)] hover:bg-[var(--color-bg)] hover:text-[var(--color-text)]'
        )}
      >
        <div className={cn(
          'flex h-7 w-7 shrink-0 items-center justify-center rounded-[var(--radius-md)] transition-all duration-200',
          active
            ? 'bg-[var(--color-primary-tint-strong)] text-[var(--color-primary)]'
            : 'bg-transparent text-[var(--color-text-muted)] group-hover:text-[var(--color-text)]'
        )}>
          <Icon className={cn('h-4 w-4', active ? 'text-[var(--color-primary)]' : '')} />
        </div>
        <span>{item.label}</span>
        {active && (
          <div className="ms-auto h-1.5 w-1.5 rounded-full bg-[var(--color-primary)]" />
        )}
      </Link>
    );
  }

  return (
    <>
      {/* Hamburger — mobile/tablet only. h-11 (44px), not h-9: a thumb needs 44px and
          this is the only way into the nav on a phone, where it sits under the notch. */}
      <button
        type="button"
        onClick={() => setIsOpen(true)}
        className={cn(
          'fixed end-3 top-3 z-[var(--z-drawer)] flex h-11 w-11 items-center justify-center rounded-[10px] bg-[var(--color-surface)] border border-[var(--color-border)] backdrop-blur-sm',
          'lg:hidden',
          isOpen && 'hidden'
        )}
        aria-label="فتح القائمة"
      >
        <Menu className="h-5 w-5 text-[var(--color-text)]" />
      </button>

      {/* Backdrop — mobile */}
      {isOpen && (
        <div
          className="fixed inset-0 z-[var(--z-drawer)] bg-black/50 backdrop-blur-sm lg:hidden animate-fade-in"
          onClick={() => setIsOpen(false)}
        />
      )}

      {/* Sidebar — z-drawer stays BELOW Modal/Sheet z-modal (300 < 500) so it never overlaps
          a modal backdrop on mobile or intercepts its backdrop-click-to-close. */}
      <aside
        className={cn(
          'fixed start-0 top-0 z-[var(--z-drawer)] flex h-dvh w-[270px] flex-col border-e border-[var(--color-border)] bg-[var(--color-surface)] transition-transform duration-300',
          isOpen ? 'translate-x-0' : 'translate-x-full',
          'lg:static lg:z-auto lg:h-auto lg:w-56 lg:translate-x-0 lg:shadow-none lg:border-e',
          'print:hidden'
        )}
      >
        {/* Header */}
        <div className="flex items-center justify-between border-b border-[var(--color-border)] px-3 py-3 lg:px-4 lg:py-4">
          <div className="flex items-center gap-2.5">
            <div className="flex h-9 w-9 items-center justify-center rounded-[10px] bg-[var(--color-primary)] text-white">
              <Store className="h-4 w-4" />
            </div>
            <div className="min-w-0">
              <div className="truncate text-sm font-bold text-[var(--color-text)]">
                {projectName}
              </div>
              <div className="flex items-center gap-1 text-[11px] text-[var(--color-text-muted)]">
                <span>دكان</span>
                <span className="h-1 w-1 rounded-full bg-[var(--color-text-muted)]" />
                <span>المطعم</span>
              </div>
            </div>
          </div>
          <button
            type="button"
            onClick={() => setIsOpen(false)}
            className="flex h-11 w-11 items-center justify-center rounded-[var(--radius-md)] hover:bg-[var(--color-bg)] lg:hidden"
            aria-label="إغلاق"
          >
            <X className="h-4 w-4 text-[var(--color-text-muted)]" />
          </button>
        </div>

        {/* Navigation */}
        <nav className="flex-1 space-y-0.5 overflow-y-auto p-2 lg:p-2">
          {NAV_MAIN.filter((item) => !item.roles || item.roles.includes(role)).map(navItem)}
        </nav>

        {/* Bottom */}
        <div className="border-t border-[var(--color-border)] p-2 space-y-0.5">
          {NAV_BOTTOM.filter((item) => !item.roles || item.roles.includes(role)).map(navItem)}

          {/* Logout */}
          <button
            type="button"
            onClick={logout}
            className="flex w-full items-center gap-3 rounded-[10px] px-3 py-2.5 text-[13px] font-semibold text-[var(--color-text-secondary)] hover:bg-[var(--color-danger-tint)] hover:text-[var(--color-danger)] transition-all duration-200"
          >
            <div className="flex h-7 w-7 shrink-0 items-center justify-center rounded-[var(--radius-md)]">
              <LogOut className="h-4 w-4" />
            </div>
            <span>تسجيل الخروج</span>
          </button>
        </div>
      </aside>
    </>
  );
}
