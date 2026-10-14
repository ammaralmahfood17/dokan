'use client';

import { Check, X } from 'lucide-react';
import type { RefObject } from 'react';
import { formatMoney } from '@/lib/utils';
import { availableChoices, effectiveBounds } from '@/lib/product-options';
import { Button } from '@/components/ui/button';
import type { ProductOptionGroup, ProductWithOptions } from '@/lib/types';

/**
 * The POS addon picker. Extracted verbatim from `pos-client.tsx` (architecture
 * review 2026-10-13, wave 4 phase b).
 *
 * Same rules module as the menu and the API (`lib/product-options`): the
 * varieties shown are the AVAILABLE ones, the bounds are clamped to them, and
 * the confirm button is disabled with its reason printed under it while the
 * selection breaks a group rule — a cashier with a queue cannot be left
 * guessing why a button does nothing.
 */
export function PosAddonPicker({
  picker,
  groups,
  selectedOptionIds,
  currency,
  violation,
  panelRef,
  onToggleOption,
  onConfirm,
  onClose,
}: {
  picker: ProductWithOptions;
  groups: ProductOptionGroup[];
  selectedOptionIds: string[];
  currency: string;
  violation: { message: string } | null;
  panelRef: RefObject<HTMLDivElement | null>;
  onToggleOption: (group: ProductOptionGroup, choiceId: string) => void;
  onConfirm: () => void;
  onClose: () => void;
}) {
  return (
    <div
      className="fixed inset-0 z-[var(--z-modal)] flex items-end justify-center bg-black/40 sm:items-center sm:p-4"
      role="dialog"
      aria-modal="true"
      aria-label={`خيارات — ${picker.name}`}
      onClick={(e) => {
        if (e.target === e.currentTarget) onClose();
      }}
      onKeyDown={(e) => {
        if (e.key === 'Escape') onClose();
      }}
    >
      <div
        ref={panelRef}
        className="w-full max-w-md max-h-[85dvh] overflow-y-auto rounded-t-[12px] bg-[var(--color-surface)] p-4 pb-safe-bottom sm:max-h-[85vh] sm:rounded-[10px] animate-slide-up"
      >
        <div className="mb-3 flex items-center justify-between">
          <h3 className="text-sm font-bold">{picker.name}</h3>
          <button type="button" onClick={onClose} className="btn btn-ghost btn-sm" aria-label="إغلاق">
            <X className="h-4 w-4" />
          </button>
        </div>
        <p className="mb-3 text-xs text-[var(--color-text-secondary)]">اختر الخيارات</p>
        <div className="mb-4 space-y-3">
          {groups.map((group) => {
            const choices = availableChoices(group);
            const bounds = effectiveBounds(group);
            const single = bounds.max === 1;
            return (
              <div key={group.id} role={single ? 'radiogroup' : 'group'} aria-label={group.name}>
                <p className="mb-1 text-[12px] font-bold text-[var(--color-text-secondary)]">
                  {group.name}
                  {bounds.min >= 1 && <span className="ms-1 text-[var(--color-primary)]">(إلزامي)</span>}
                </p>
                <ul className="space-y-1.5">
                  {choices.map((choice) => {
                    const on = selectedOptionIds.includes(choice.id);
                    return (
                      <li key={choice.id}>
                        <button
                          type="button"
                          role={single ? 'radio' : 'checkbox'}
                          aria-checked={on}
                          onClick={() => onToggleOption(group, choice.id)}
                          className={`flex min-h-[44px] w-full items-center justify-between gap-2 rounded-[var(--radius-md)] border px-3 py-2 text-sm transition-colors ${
                            on
                              ? 'border-[var(--color-primary)] bg-[var(--color-primary-tint)] font-semibold'
                              : 'border-[var(--color-border)]'
                          }`}
                        >
                          <span className="flex items-center gap-2">
                            <span
                              aria-hidden="true"
                              className={`flex items-center justify-center border ${
                                single ? 'rounded-full' : 'rounded-[4px]'
                              } ${
                                on
                                  ? 'border-[var(--color-primary)] bg-[var(--color-primary)] text-white'
                                  : 'border-[var(--color-border-strong)]'
                              }`}
                              style={{ height: '18px', width: '18px' }}
                            >
                              {on && <Check className="h-3 w-3" />}
                            </span>
                            {choice.name}
                          </span>
                          <span className="shrink-0 text-xs text-[var(--color-text-secondary)]">
                            {Number(choice.price) > 0
                              ? `+${formatMoney(Number(choice.price), currency)}`
                              : 'بدون زيادة'}
                          </span>
                        </button>
                      </li>
                    );
                  })}
                </ul>
              </div>
            );
          })}
        </div>
        <div className="flex gap-2">
          <Button block disabled={violation !== null} onClick={onConfirm}>
            إضافة للسلة
          </Button>
          <Button variant="secondary" onClick={onClose}>
            إلغاء
          </Button>
        </div>
        {violation && (
          <p role="alert" className="mt-2 text-center text-[12.5px] font-semibold text-[var(--color-danger)]">
            {violation.message}
          </p>
        )}
      </div>
    </div>
  );
}
