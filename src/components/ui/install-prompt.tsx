'use client';

// D15: "Add to Home Screen" prompt — listens for beforeinstallprompt
// (Chrome/Android) and shows a small install button. iOS Safari has no
// beforeinstallprompt; the menu's PWA hint (share → add to home screen) is
// shown separately in the UI when supported. Dismissed state is remembered
// for the session only.
import { useEffect, useState } from 'react';
import { Download, X } from 'lucide-react';

const DISMISSED_AT_KEY = 'dokan-install-dismissed-at';
const DISMISS_FOR_MS = 7 * 24 * 60 * 60 * 1000;

interface BeforeInstallPromptEvent extends Event {
  prompt: () => Promise<void>;
  userChoice: Promise<{ outcome: 'accepted' | 'dismissed' }>;
}

export function InstallPrompt() {
  const [deferred, setDeferred] = useState<BeforeInstallPromptEvent | null>(null);
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

  if (!deferred || dismissed) return null;

  return (
    <div
      role="dialog"
      aria-label="تثبيت التطبيق"
      className="fixed bottom-20 inset-x-0 z-[var(--z-drawer)] mx-auto flex w-[calc(100%-2rem)] max-w-md items-center gap-3 rounded-[10px] border border-[var(--color-border)] bg-[var(--color-surface)] p-3 shadow-float"
    >
      <div className="min-w-0 flex-1">
        <p className="text-[13px] font-bold">ثبّت تطبيق دكان</p>
        <p className="text-[11.5px] text-[var(--color-text-secondary)]">
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
