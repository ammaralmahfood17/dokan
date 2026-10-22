'use client';

// D15: "Add to Home Screen" prompt — listens for beforeinstallprompt
// (Chrome/Android) and shows a small install button. iOS Safari has no
// beforeinstallprompt; the menu's PWA hint (share → add to home screen) is
// shown separately in the UI when supported. Dismissed state is remembered
// for the session only.
//
// Audit 2026-10-22 (P1): the card used to appear on the FIRST screen load of
// every route — including /login and the merchant dashboard — and covered the
// product grid, the orders table and the sign-in form. It is now gated twice:
// (a) never on an app/auth route (a cashier does not need it inside POS), and
// (b) only for a RETURNING visitor (2nd+ full page load): a customer who just
// scanned the QR wants to order, not install. Local dismissal still wins.
import { useEffect, useState } from 'react';
import { usePathname } from 'next/navigation';
import { useOnline } from '@/components/ui/use-online';
import { Download, X } from 'lucide-react';

const DISMISSED_AT_KEY = 'dokan-install-dismissed-at';
const DISMISS_FOR_MS = 7 * 24 * 60 * 60 * 1000;
const VISITS_KEY = 'dokan-visit-count';

/** Routes where the install card is never relevant (merchant app, auth, legal). */
const APP_ROUTE_PREFIXES = [
  '/dashboard',
  '/super-admin',
  '/onboarding',
  '/login',
  '/register',
  '/reset-password',
  '/update-password',
  '/terms',
  '/privacy',
];


interface BeforeInstallPromptEvent extends Event {
  prompt: () => Promise<void>;
  userChoice: Promise<{ outcome: 'accepted' | 'dismissed' }>;
}

export function InstallPrompt() {
  const pathname = usePathname();
  // Installing is a network action: the card used to sit under the «غير متصل»
  // banner offering an install that cannot start.
  const isOnline = useOnline();
  const [deferred, setDeferred] = useState<BeforeInstallPromptEvent | null>(null);
  // Read before paint, like `dismissed`: the card may only render for a visitor
  // who has already loaded the product once (see the header comment).
  const [returning] = useState(() => {
    try {
      if (typeof window === 'undefined') return false;
      return (Number(localStorage.getItem(VISITS_KEY)) || 0) >= 1;
    } catch {
      return false;
    }
  });
  const [dismissed, setDismissed] = useState(() => {
    try {
      if (typeof window === 'undefined') return false;
      const dismissedAt = Number(localStorage.getItem(DISMISSED_AT_KEY));
      return Boolean(dismissedAt && Date.now() - dismissedAt < DISMISS_FOR_MS);
    } catch {
      return false;
    }
  });

  useEffect(() => {
    const handler = (e: Event) => {
      e.preventDefault();
      setDeferred(e as BeforeInstallPromptEvent);
    };
    const installed = () => {
      setDeferred(null);
      setDismissed(true);
    };
    window.addEventListener('beforeinstallprompt', handler);
    window.addEventListener('appinstalled', installed);
    // Count this page load for the NEXT visit; a side effect only, so the gate
    // above can stay a pure read (setState inside an effect is a lint error here).
    try {
      const visits = Number(localStorage.getItem(VISITS_KEY)) || 0;
      localStorage.setItem(VISITS_KEY, String(visits + 1));
    } catch {
      // Storage unavailable: the prompt stays first-visit-only (hidden) — fail quiet.
    }
    return () => {
      window.removeEventListener('beforeinstallprompt', handler);
      window.removeEventListener('appinstalled', installed);
    };
  }, []);

  function dismiss() {
    setDismissed(true);
    try {
      localStorage.setItem(DISMISSED_AT_KEY, String(Date.now()));
    } catch {
      // Session-only dismissal is still adequate when storage is unavailable.
    }
  }

  const onAppRoute = APP_ROUTE_PREFIXES.some(
    (p) => pathname === p || pathname.startsWith(`${p}/`)
  );
  if (!deferred || dismissed || !returning || onAppRoute || !isOnline) return null;

  return (
    <div
      /* audit T1 #13: nothing here is modal, traps focus or is labelled - role="dialog" only
         confused assistive tech. It is a passive announcement. */
      role="status"
      aria-live="polite"
      className="fixed bottom-20 inset-x-0 z-[var(--z-drawer)] mx-auto flex w-[calc(100%-2rem)] max-w-md items-center gap-3 rounded-[10px] border border-[var(--color-border)] bg-[var(--color-surface)] p-3 shadow-float"
    >
      <div className="min-w-0 flex-1">
        <p className="text-[13px] font-bold">ثبّت تطبيق دكان</p>
        <p className="text-caption text-[var(--color-text-secondary)]">
          أضف دكان إلى شاشتك الرئيسية لفتح أسرع
        </p>
      </div>
      <button
        type="button"
        onClick={async () => {
          await deferred.prompt();
          setDeferred(null);
        }}
        className="flex h-11 shrink-0 items-center gap-1.5 rounded-[var(--radius-md)] bg-[var(--color-primary)] px-3.5 text-[12.5px] font-bold text-white transition-colors hover:opacity-90"
      >
        <Download className="h-4 w-4" />
        تثبيت
      </button>
      <button
        type="button"
        aria-label="إغلاق"
        onClick={dismiss}
        className="flex h-11 w-11 shrink-0 items-center justify-center rounded-[var(--radius-md)] text-[var(--color-text-muted)] hover:bg-[var(--color-surface-sunken)]"
      >
        <X className="h-4 w-4" />
      </button>
    </div>
  );
}
