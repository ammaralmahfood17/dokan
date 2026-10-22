'use client';

import { langOfText } from '@/lib/i18n';

/**
 * The public menu's header: brand mark, store name, the table chip, and the two
 * service buttons («موظف» / «فاتورة»).
 *
 * Extracted verbatim from `menu-client.tsx` (architecture review 2026-10-13,
 * wave 4 phase b). Presentational: the client owns the service-call state.
 */
export function MenuHeader({
  projectName,
  tableNumber,
  lang,
  busyAction,
  onCallService,
}: {
  projectName: string;
  tableNumber: number;
  lang: 'ar' | 'en';
  busyAction: 'waiter' | 'bill' | null;
  onCallService: (kind: 'waiter' | 'bill') => void;
}) {
  return (
    <header
      className="sticky top-0 z-[var(--z-sticky)] border-b border-[var(--color-border)] px-4 py-3.5 backdrop-blur-md"
      style={{ background: 'color-mix(in srgb, var(--color-bg) 92%, transparent)' }}
    >
      <div className="menu-shell flex items-center justify-between gap-3">
        <div className="flex min-w-0 items-center gap-2.5">
          <div className="flex h-10 w-10 shrink-0 items-center justify-center rounded-[10px] bg-[var(--color-text)] font-display text-[18px] font-bold text-[var(--color-bg)]">
            {projectName.slice(0, 1)}
          </div>
          <div className="min-w-0">
            <h1 lang={langOfText(projectName)} className="truncate font-display text-[17px] font-bold">
              {projectName}
            </h1>
            <p className="text-caption text-[var(--color-text-secondary)]">امسح واطلب من طاولتك</p>
          </div>
        </div>
        {/* Table chip */}
        <div className="flex items-center gap-1.5">
          <div className="rounded-full border border-[var(--color-border-strong)] px-3 py-1 font-mono text-[12px] font-semibold tabular-nums text-[var(--color-text-secondary)]">
            {lang === 'en' ? 'Table' : 'طاولة'}{' '}
            <span dir="ltr">{String(tableNumber).padStart(2, '0')}</span>
          </div>
          <button
            type="button"
            disabled={busyAction !== null}
            onClick={() => onCallService('waiter')}
            className="min-h-[44px] rounded-[var(--radius-md)] border border-[var(--color-border)] bg-[var(--color-surface)] px-3 text-xs font-bold transition-colors hover:bg-[var(--color-bg)] disabled:opacity-50"
          >
            موظف
          </button>
          <button
            type="button"
            disabled={busyAction !== null}
            onClick={() => onCallService('bill')}
            className="min-h-[44px] rounded-[var(--radius-md)] border border-[var(--color-border)] bg-[var(--color-surface)] px-3 text-xs font-bold transition-colors hover:bg-[var(--color-bg)] disabled:opacity-50"
          >
            فاتورة
          </button>
        </div>
      </div>
    </header>
  );
}
