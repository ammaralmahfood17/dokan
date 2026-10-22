'use client';

import type { ButtonHTMLAttributes } from 'react';
import { cn } from '@/lib/utils';

/**
 * The ONE category/filter pill.
 *
 * There used to be two: the customer menu filled the active pill with the brand
 * colour, POS tinted it — the same control, two pictures of the same state
 * (design audit 2026-10-22, P2). Filled wins because a filter has to read as
 * chosen at a glance and white on --color-primary is 5.54:1.
 *
 * `aria-pressed` is part of the component, not the caller's job: a filter that
 * looks selected but reports nothing to assistive tech is the failure mode this
 * replaces.
 */
export function FilterPill({
  active,
  className,
  children,
  ...props
}: ButtonHTMLAttributes<HTMLButtonElement> & { active: boolean }) {
  return (
    <button
      type="button"
      aria-pressed={active}
      className={cn(
        'min-h-[44px] shrink-0 whitespace-nowrap rounded-full border px-4 text-[13px] font-semibold transition-colors',
        active
          ? 'border-[var(--color-primary)] bg-[var(--color-primary)] text-white'
          : 'border-[var(--color-border-strong)] bg-[var(--color-surface)] text-[var(--color-text-secondary)] hover:border-[var(--color-text-tertiary)] hover:text-[var(--color-text)]',
        className
      )}
      {...props}
    >
      {children}
    </button>
  );
}
