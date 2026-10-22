'use client';

import { Plus, Trash2 } from 'lucide-react';
import { currencyDecimals } from '@/lib/utils';
import type { FormGroup } from '@/components/dashboard/products/use-option-group-editor';

/**
 * «الخيارات» — the option tree editor: each group has a name, the
 * one-or-many / required-or-optional switches, and its varieties with their own
 * price.
 *
 * Extracted verbatim from `product-form-modal.tsx` (architecture review
 * 2026-10-13, wave 4 phase b). It is purely presentational: the state and its
 * mutators live in `use-option-group-editor`, so this file holds no rule about
 * what a valid group is — the save path decides that (lib/product-form).
 */
export function OptionGroupEditor({
  groups,
  currency,
  onAddGroup,
  onUpdateGroup,
  onRemoveGroup,
  onAddChoice,
  onUpdateChoice,
  onRemoveChoice,
}: {
  groups: FormGroup[];
  currency: string;
  onAddGroup: () => void;
  onUpdateGroup: (key: string, patch: Partial<Pick<FormGroup, 'name' | 'required' | 'single'>>) => void;
  onRemoveGroup: (key: string) => void;
  onAddChoice: (groupKey: string) => void;
  onUpdateChoice: (groupKey: string, choiceKey: string, field: 'name' | 'price', value: string) => void;
  onRemoveChoice: (groupKey: string, choiceKey: string) => void;
}) {
  return (
    <fieldset className="rounded-[var(--radius-md)] border border-[var(--color-border)] bg-[var(--color-bg)] p-3">
      <div className="mb-1 flex items-center justify-between">
        <legend className="label mb-0">
          الخيارات <span className="text-[var(--color-text-muted)]">(اختياري)</span>
        </legend>
        <button type="button" onClick={onAddGroup} className="btn btn-ghost btn-sm gap-1">
          <Plus className="h-3.5 w-3.5" />
          خيار جديد
        </button>
      </div>
      <p className="mb-3 text-caption leading-relaxed text-[var(--color-text-muted)]">
        مثال: خيار «الحجم» وأنواعه صغير / وسط / كبير — ولكل نوع سعره.
      </p>

      {groups.length === 0 && (
        <p className="rounded-[var(--radius-md)] bg-[var(--color-surface)] px-3 py-4 text-center text-xs text-[var(--color-text-muted)]">
          ما فيه خيارات.
        </p>
      )}

      {groups.map((group) => (
        <div
          key={group.key}
          className="mb-3 rounded-[var(--radius-md)] border border-[var(--color-border)] bg-[var(--color-surface)] p-3"
        >
          <div className="mb-2 flex items-center gap-2">
            <input
              className="input flex-1 text-sm"
              placeholder="اسم الخيار (مثال: الحجم)"
              maxLength={50}
              value={group.name}
              onChange={(e) => onUpdateGroup(group.key, { name: e.target.value })}
              aria-label="اسم الخيار"
            />
            <button
              type="button"
              onClick={() => onRemoveGroup(group.key)}
              aria-label={`حذف الخيار ${group.name || ''}`.trim()}
              className="btn btn-ghost btn-sm shrink-0 text-[var(--color-danger)]"
            >
              <Trash2 className="h-3.5 w-3.5" />
            </button>
          </div>

          <div className="mb-3 flex flex-wrap gap-x-4 gap-y-1.5 text-[12.5px]">
            <label className="flex min-h-[32px] cursor-pointer items-center gap-1.5">
              <input
                type="checkbox"
                className="h-4 w-4"
                checked={group.single}
                onChange={(e) => onUpdateGroup(group.key, { single: e.target.checked })}
              />
              يختار نوعاً واحداً
            </label>
            <label className="flex min-h-[32px] cursor-pointer items-center gap-1.5">
              <input
                type="checkbox"
                className="h-4 w-4"
                checked={group.required}
                onChange={(e) => onUpdateGroup(group.key, { required: e.target.checked })}
              />
              إلزامي
            </label>
          </div>

          <p className="mb-1.5 text-caption font-semibold text-[var(--color-text-secondary)]">الأنواع</p>
          {group.choices.map((choice) => (
            <div key={choice.key} className="mb-2 flex items-center gap-2">
              <input
                className="input flex-1 text-sm"
                placeholder="اسم النوع (مثال: كبير)"
                maxLength={50}
                value={choice.name}
                onChange={(e) => onUpdateChoice(group.key, choice.key, 'name', e.target.value)}
                aria-label="اسم النوع"
              />
              <div className="relative w-24 shrink-0">
                <input
                  className="input w-full text-sm"
                  type="number"
                  step="0.001"
                  min="0"
                  dir="ltr"
                  inputMode="decimal"
                  placeholder={`0.${'0'.repeat(currencyDecimals(currency))}`}
                  value={choice.price}
                  onChange={(e) => onUpdateChoice(group.key, choice.key, 'price', e.target.value)}
                  aria-label="سعر النوع"
                />
              </div>
              <button
                type="button"
                onClick={() => onRemoveChoice(group.key, choice.key)}
                aria-label={`حذف النوع ${choice.name || ''}`.trim()}
                className="btn btn-ghost btn-sm shrink-0 text-[var(--color-danger)]"
              >
                <Trash2 className="h-3.5 w-3.5" />
              </button>
            </div>
          ))}
          <button type="button" onClick={() => onAddChoice(group.key)} className="btn btn-ghost btn-sm gap-1">
            <Plus className="h-3.5 w-3.5" />
            نوع
          </button>
        </div>
      ))}
    </fieldset>
  );
}
