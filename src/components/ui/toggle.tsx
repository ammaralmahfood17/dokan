'use client';

import { cn } from '@/lib/utils';

interface ToggleProps {
  checked: boolean;
  onChange: (value: boolean) => void;
  disabled?: boolean;
  id?: string;
  'aria-label'?: string;
}

/**
 * Toggle switch (role="switch") — token-based, RTL-aware, WCAG-friendly.
 * - Knob travels start→end using logical RTL translation.
 * - focus-visible ring + aria-checked for keyboard/AT support.
 * - motion-reduce disables the transition.
 *
 * Usage:
 *   <Toggle id="store-active" checked={isActive} onChange={setIsActive} />
 */
export function Toggle({
  checked,
  onChange,
  disabled,
  id,
  'aria-label': ariaLabel,
}: ToggleProps) {
  return (
    <button
      id={id}
      type="button"
      role="switch"
      aria-checked={checked}
      aria-label={ariaLabel}
      disabled={disabled}
      onClick={() => onChange(!checked)}
      className={cn(
        // Visual track stays 28×52; :before with -inset-2 expands the actual
        // touch/click target to 44×68 (margin does NOT extend the hit area).
        'relative inline-flex h-[28px] w-[52px] shrink-0 items-center rounded-full border-2 border-transparent transition-colors duration-[var(--motion-fast)]',
        'before:absolute before:-inset-2 before:content-[""]',
        'focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-[var(--color-primary)] focus-visible:ring-offset-2 focus-visible:ring-offset-[var(--color-surface)]',
        'motion-reduce:transition-none',
        checked ? 'bg-[var(--color-primary)]' : 'bg-[var(--color-border)]',
        disabled && 'cursor-not-allowed opacity-50'
      )}
    >
      <span
        className={cn(
          'pointer-events-none relative inline-block h-[24px] w-[24px] rounded-full bg-white transition-transform duration-[var(--motion-fast)]',
          'motion-reduce:transition-none',
          checked && 'translate-x-[24px] rtl:-translate-x-[24px]'
        )}
      />
    </button>
  );
}
