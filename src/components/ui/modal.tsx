'use client';

import { useCallback, useEffect, useId, useRef, useState, type ReactNode } from 'react';
import { X } from 'lucide-react';

interface ModalProps {
  title: string;
  children: ReactNode;
  onClose: () => void;
}

/**
 * Modal with focus trap, ESC to close, and backdrop click.
 * A11Y: traps focus inside modal, closes on Escape, animates from bottom on mobile.
 */
// D3: aria-labelledby — the dialog title id links to the heading so screen
// readers announce the modal's purpose instead of just "dialog".
export function Modal({ title, children, onClose }: ModalProps) {
  const trapRef = useRef<HTMLDivElement>(null);
  const titleId = useId();
  // FIX-O-002: exit animation — closing state + timeout ثم onClose
  const [closing, setClosing] = useState(false);
  const closeTimer = useRef<ReturnType<typeof setTimeout> | null>(null);

  const requestClose = useCallback(() => {
    if (closing) return;
    setClosing(true);
    closeTimer.current = setTimeout(() => onClose(), 200);
  }, [closing, onClose]);

  // Cleanup timer on unmount
  useEffect(() => {
    return () => {
      if (closeTimer.current) clearTimeout(closeTimer.current);
    };
  }, []);

  // Focus trap: keep Tab within modal
  const handleKeyDown = useCallback(
    (e: KeyboardEvent) => {
      if (e.key === 'Escape') {
        requestClose();
        return;
      }
      if (e.key !== 'Tab') return;

      const el = trapRef.current;
      if (!el) return;
      const focusable = el.querySelectorAll<HTMLElement>(
        'button, [href], input, select, textarea, [tabindex]:not([tabindex="-1"])'
      );
      if (focusable.length === 0) return;
      const first = focusable[0];
      const last = focusable[focusable.length - 1];

      if (e.shiftKey && document.activeElement === first) {
        e.preventDefault();
        last?.focus();
      } else if (!e.shiftKey && document.activeElement === last) {
        e.preventDefault();
        first?.focus();
      }
    },
    // FIX-O-002: requestClose مطلوب (ESC يستخدمه) — onClose غير مستخدم هنا
    [requestClose]
  );

  // Auto-focus first text input only on initial mount
  useEffect(() => {
    const el = trapRef.current;
    if (!el) return;

    const firstInput = el.querySelector<HTMLElement>(
      'input:not([type="hidden"]):not([type="checkbox"]):not([type="radio"]), textarea'
    );
    // audit T1 #6 (WCAG 2.4.3): without a fallback, a dialog with no input left focus on
    // <body> and was never announced. The panel itself is focusable for exactly this case.
    requestAnimationFrame(() => (firstInput ?? el).focus());
  }, []);

  // audit T1 #6: remember who opened the dialog and hand focus back when it unmounts.
  // Escape or a save used to drop focus to <body>, losing the keyboard user's place.
  useEffect(() => {
    const opener = document.activeElement as HTMLElement | null;
    return () => {
      opener?.focus?.();
    };
  }, []);

  // Keydown listener + body scroll lock (industry standard)
  useEffect(() => {
    document.addEventListener('keydown', handleKeyDown);

    // Lock body scroll: fixed position + preserve scroll position
    const scrollY = window.scrollY;
    document.body.style.position = 'fixed';
    document.body.style.top = `-${scrollY}px`;
    document.body.style.width = '100%';
    document.body.style.overflowY = 'scroll'; // prevent layout shift

    return () => {
      document.removeEventListener('keydown', handleKeyDown);
      // Restore body scroll
      document.body.style.position = '';
      document.body.style.top = '';
      document.body.style.width = '';
      document.body.style.overflowY = '';
      window.scrollTo(0, scrollY);
    };
  }, [handleKeyDown]);

  return (
    <div
      className="fixed inset-0 z-[var(--z-modal)] flex items-start justify-center bg-black/40 sm:items-center sm:p-4"
      /* audit T1 #20: the backdrop click is a POINTER convenience; the semantic dialog is the
         panel below (role="dialog"), so this wrapper is presentational. Escape (handled on the
         document) remains the keyboard path. */
      role="presentation"
      onClick={(e) => {
        if (e.target === e.currentTarget) requestClose();
      }}
      onKeyDown={(e) => {
        if (e.key === 'Escape') requestClose();
      }}
    >
      <div
        ref={trapRef}
        className={`max-h-dvh w-full max-w-md overflow-y-auto rounded-b-none bg-[var(--color-surface)] sm:max-h-[85vh] sm:rounded-[10px] ${closing ? "modal-exit" : "modal-enter"} pb-safe-bottom`}
        style={{ WebkitOverflowScrolling: 'touch', overscrollBehavior: 'contain' }}
        role="dialog"
        aria-modal="true"
        aria-labelledby={titleId}
        /* audit T1 #6: focusable so the no-input fallback above has somewhere to land. */
        tabIndex={-1}
      >
        <div className="flex items-center justify-between border-b border-[var(--color-border)] px-4 py-3">
          <h3 id={titleId} className="text-sm font-bold">{title}</h3>
          <button
            type="button"
            onClick={requestClose}
            className="btn btn-ghost btn-sm"
            aria-label="إغلاق"
          >
            <X className="h-4 w-4" />
          </button>
        </div>
        <div className="p-4">{children}</div>
      </div>
    </div>
  );
}
