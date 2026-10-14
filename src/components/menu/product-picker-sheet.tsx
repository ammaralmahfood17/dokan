'use client';

import { Check } from 'lucide-react';
import { formatMoney } from '@/lib/utils';
import { availableChoices, effectiveBounds } from '@/lib/product-options';
import { Sheet } from '@/components/menu/sheet';
import { Button } from '@/components/ui/button';
import type { ProductOptionGroup, ProductWithOptions } from '@/lib/types';

/** UX-6: one-tap common item notes (drinks + food, Gulf phrasing). */
const QUICK_NOTE_CHIPS = ['بدون سكر', 'بدون ثلج', 'ثلج على جنب', 'حار زيادة'];

/**
 * The product picker: the varieties of each group, the one-tap note chips, the
 * free-text note, and the confirm button with its reason when it is disabled.
 *
 * Extracted verbatim from `menu-client.tsx` (architecture review 2026-10-13,
 * wave 4 phase b). Presentational: the selection, the note and the validation
 * decision all live in the client (and the rules in lib/menu-cart).
 *
 * The confirm button is disabled while the selection violates a group rule, and
 * the violation message is rendered UNDER it — the customer reads why, instead
 * of tapping a dead button.
 */
export function ProductPickerSheet({
  picker,
  groups,
  selectedOptionIds,
  total,
  currency,
  notes,
  onNotesChange,
  onToggleQuickNote,
  onToggleOption,
  violation,
  onConfirm,
  onClose,
}: {
  picker: ProductWithOptions;
  groups: ProductOptionGroup[];
  selectedOptionIds: string[];
  total: number;
  currency: string;
  notes: string;
  onNotesChange: (value: string) => void;
  onToggleQuickNote: (note: string) => void;
  onToggleOption: (group: ProductOptionGroup, choiceId: string) => void;
  violation: { message: string } | null;
  onConfirm: () => void;
  onClose: () => void;
}) {
  return (
    <Sheet onClose={onClose} title={picker.name}>
      {picker.description && (
        <p className="mb-3 text-sm text-[var(--color-text-secondary)]">{picker.description}</p>
      )}
      <p className="mb-3 text-base font-bold" style={{ color: 'var(--color-primary)' }} aria-live="polite">
        {formatMoney(total, currency)}
      </p>
      {groups.length > 0 && (
        <div className="mb-4 space-y-4">
          {groups.map((group) => {
            const choices = availableChoices(group);
            const bounds = effectiveBounds(group);
            const single = bounds.max === 1;
            const pickedInGroup = choices.filter((c) => selectedOptionIds.includes(c.id)).length;
            return (
              <div key={group.id} role={single ? 'radiogroup' : 'group'} aria-label={group.name}>
                <p className="section-title flex flex-wrap items-center gap-2">
                  {group.name}
                  {bounds.min >= 1 && (
                    <span className="rounded-full bg-[var(--color-primary-tint)] px-2 py-0.5 text-[11.5px] font-bold text-[var(--color-primary)]">
                      إلزامي
                    </span>
                  )}
                  {!single && (
                    <span className="text-[11.5px] font-normal text-[var(--color-text-muted)]">
                      {pickedInGroup}/{bounds.max} — اختر حتى {bounds.max}
                    </span>
                  )}
                </p>
                <ul className="space-y-2">
                  {choices.map((choice) => {
                    const on = selectedOptionIds.includes(choice.id);
                    return (
                      <li key={choice.id}>
                        <button
                          type="button"
                          role={single ? 'radio' : 'checkbox'}
                          aria-checked={on}
                          onClick={() => onToggleOption(group, choice.id)}
                          className={`flex min-h-[48px] w-full items-center justify-between gap-2 rounded-[var(--radius-md)] border px-3 py-2.5 text-sm transition-colors ${
                            on
                              ? 'border-[var(--color-primary)] bg-[var(--color-primary-tint)] font-semibold'
                              : 'border-[var(--color-border)] hover:border-[var(--color-border-strong)]'
                          }`}
                        >
                          <span className="flex items-center gap-2">
                            <span
                              aria-hidden="true"
                              className={`flex h-4.5 w-4.5 items-center justify-center border ${
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
      )}
      <div className="field">
        <label htmlFor="item-notes" className="label">
          ملاحظة على الصنف
        </label>
        {/* UX-6: quick-note chips — most common Gulf requests, one tap each.
            Toggle adds/removes the phrase from the notes text. */}
        <div className="mb-2 flex flex-wrap gap-1.5" role="group" aria-label="ملاحظات سريعة">
          {QUICK_NOTE_CHIPS.map((note) => {
            const on = notes.includes(note);
            return (
              <button
                key={note}
                type="button"
                onClick={() => onToggleQuickNote(note)}
                aria-pressed={on}
                className={`min-h-[44px] rounded-full border px-3.5 text-[12.5px] font-semibold transition-colors ${
                  on
                    ? 'border-[var(--color-primary)] bg-[var(--color-primary-tint)] text-[var(--color-primary)]'
                    : 'border-[var(--color-border-strong)] bg-[var(--color-surface)] text-[var(--color-text-secondary)]'
                }`}
              >
                {note}
              </button>
            );
          })}
        </div>
        <input
          id="item-notes"
          className="input"
          value={notes}
          onChange={(e) => {
            if (e.target.value.length <= 200) onNotesChange(e.target.value);
          }}
          placeholder="مثال: بدون سكر"
          maxLength={200}
        />
        <p className="hint">{notes.length}/200</p>
      </div>
      <Button block disabled={violation !== null} onClick={onConfirm} style={{ background: 'var(--color-primary)' }}>
        أضف إلى السلة
      </Button>
      {violation && (
        <p role="alert" className="mt-2 text-center text-[12.5px] font-semibold text-[var(--color-danger)]">
          {violation.message}
        </p>
      )}
    </Sheet>
  );
}
