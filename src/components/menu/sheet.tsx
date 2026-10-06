'use client';

// D2: Bottom sheet with drag-to-dismiss — extracted from menu-client.tsx.
// Generic dialog surface used by the product picker + cart on the public menu.
import { useCallback, useEffect, useRef, type ReactNode } from 'react';
import { GripHorizontal, X } from 'lucide-react';

export function Sheet({
  title,
  children,
  onClose,
}: {
  title: string;
  children: ReactNode;
  onClose: () => void;
}) {
  const sheetRef = useRef<HTMLDivElement>(null);
  const startY = useRef(0);
  const currentY = useRef(0);

  // The parent passes an inline arrow (`onClose={() => setX(null)}`), so its
  // identity changes on EVERY render — including the render caused by typing a
  // character into an input inside the sheet. Holding it in a ref keeps the
  // keydown handler (and therefore the mount effect below) stable: a handler
  // that changed per keystroke re-ran the effect, whose cleanup restored focus
  // to the element that opened the sheet. On mobile that stole focus from the
  // input mid-word and dismissed the keyboard after the first character.
  const onCloseRef = useRef(onClose);
  useEffect(() => {
    onCloseRef.current = onClose;
  });

  // Focus trap — stable identity ([] deps) so it never re-subscribes mid-typing.
  const handleKeyDown = useCallback((e: KeyboardEvent) => {
    if (e.key === 'Escape') { onCloseRef.current(); return; }
    if (e.key !== 'Tab') return;
    const el = sheetRef.current;
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
  }, []);

  // Scroll lock + keyboard listener + focus management — runs ONCE per mount.
  useEffect(() => {
    document.addEventListener('keydown', handleKeyDown);
    const scrollY = window.scrollY;
    document.body.style.position = 'fixed';
    document.body.style.top = `-${scrollY}px`;
    document.body.style.width = '100%';
    document.body.style.overflowY = 'scroll';

    // Focus trap: move focus INTO the sheet on open so the first Tab lands
    // inside the dialog, not on background controls behind the overlay.
    const previouslyFocused = document.activeElement as HTMLElement | null;
    const panel = sheetRef.current?.querySelector<HTMLElement>(
      'button, [href], input, select, textarea, [tabindex]:not([tabindex="-1"])'
    );
    panel?.focus();

    return () => {
      document.removeEventListener('keydown', handleKeyDown);
      document.body.style.position = '';
      document.body.style.top = '';
      document.body.style.width = '';
      document.body.style.overflowY = '';
      window.scrollTo(0, scrollY);
      // Restore focus to whatever opened the sheet.
      previouslyFocused?.focus?.();
    };
  }, [handleKeyDown]);

  function onTouchStart(e: React.TouchEvent) {
    startY.current = e.touches[0].clientY;
    currentY.current = 0;
  }

  function onTouchMove(e: React.TouchEvent) {
    const dy = e.touches[0].clientY - startY.current;
    if (dy < 0) return;
    currentY.current = dy;
    if (sheetRef.current) {
      sheetRef.current.style.transform = `translateY(${dy}px)`;
      sheetRef.current.style.transition = 'none';
    }
  }

  function onTouchEnd() {
    if (currentY.current > 80) onClose();
    if (sheetRef.current) {
      sheetRef.current.style.transform = '';
      sheetRef.current.style.transition = '';
    }
    currentY.current = 0;
  }

  return (
    <div
      className="fixed inset-0 z-[var(--z-modal)] flex items-end justify-center bg-black/40 sm:items-center sm:p-4"
      role="dialog"
      aria-modal="true"
      aria-label={title}
      onClick={(e) => { if (e.target === e.currentTarget) onClose(); }}
      onKeyDown={(e) => { if (e.key === 'Escape') onClose(); }}
    >
      <div
        ref={sheetRef}
        className="max-h-dvh w-full max-w-lg overflow-y-auto rounded-t-[12px] bg-[var(--color-surface)] pb-safe-bottom shadow-float transition-transform duration-300 sm:max-h-[85vh] sm:rounded-[12px] animate-slide-up"
      >
        {/* Drag handle + header */}
        <div className="sticky top-0 z-[var(--z-sticky)] flex items-center justify-between border-b border-[var(--color-border)] bg-[var(--color-surface)] px-4 py-3">
          <div className="flex items-center gap-2">
            {/* Drag handle indicator */}
            <div
              className="flex cursor-grab touch-none items-center justify-center active:cursor-grabbing"
              onTouchStart={onTouchStart}
              onTouchMove={onTouchMove}
              onTouchEnd={onTouchEnd}
            >
              <GripHorizontal className="h-4 w-4 text-[var(--color-text-muted)]" />
            </div>
            <h3 className="text-sm font-bold">{title}</h3>
          </div>
          <button
            type="button"
            aria-label="إغلاق"
            onClick={onClose}
            className="min-h-[44px] min-w-[44px] rounded-[var(--radius-md)] transition-colors hover:bg-[var(--color-bg)]"
          >
            <X className="mx-auto h-5 w-5 text-[var(--color-text-muted)]" />
          </button>
        </div>
        <div className="p-4">{children}</div>
      </div>
    </div>
  );
}
