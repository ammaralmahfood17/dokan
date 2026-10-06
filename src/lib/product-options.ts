import type { ProductOptionChoice, ProductOptionGroup } from './types';

/**
 * Option-selection rules, in ONE place.
 *
 * The customer menu, the POS picker and the server-side order validation all
 * have to agree on three things: which varieties are pickable, how many a group
 * allows, and what "required" means when the group is partly sold out. Two
 * copies of that logic would drift, and a drift shows up as an order the UI
 * happily accepted and the server rejected (or worse, priced differently).
 *
 * These functions mirror `create_order_transactional` (migration
 * 20261006190000) exactly — including the clamping rule below.
 */

/** Only available varieties are pickable, ordered as the merchant arranged them. */
export function availableChoices(group: ProductOptionGroup): ProductOptionChoice[] {
  return (group.option_choices ?? [])
    .filter((c) => c.is_available)
    .slice()
    .sort((a, b) => a.sort_order - b.sort_order);
}

/**
 * The bounds that actually apply, clamped to how many varieties are still
 * available.
 *
 * A group whose varieties are ALL sold out stops being required — otherwise a
 * sold-out size would make the whole product unorderable, and the customer would
 * see a "required" group with nothing to tap. `max` is at least 1 so a group
 * that still has choices can always be selected.
 */
export function effectiveBounds(group: ProductOptionGroup): { min: number; max: number } {
  const count = availableChoices(group).length;
  if (count === 0) return { min: 0, max: 0 };
  return {
    min: Math.min(Math.max(group.min_select, 0), count),
    max: Math.max(1, Math.min(Math.max(group.max_select, 1), count)),
  };
}

/** A group the customer must answer before the product can be added. */
export function isRequired(group: ProductOptionGroup): boolean {
  return effectiveBounds(group).min >= 1;
}

export type OptionSelectionError = { groupName: string; message: string };

/**
 * Validate a whole product's selection.
 *
 * @param groups      every option group of the product (available or not)
 * @param selectedIds the choice ids the customer picked
 * @returns null when valid, otherwise the first violation with a readable reason
 */
export function validateOptionSelection(
  groups: ProductOptionGroup[],
  selectedIds: string[]
): OptionSelectionError | null {
  const wanted = new Set(selectedIds);

  // 1. Every picked id must be an AVAILABLE variety of THIS product.
  const known = new Set(groups.flatMap((g) => availableChoices(g).map((c) => c.id)));
  for (const id of wanted) {
    if (!known.has(id)) {
      return { groupName: '', message: 'خيار غير صالح — حدّث القائمة وأعد المحاولة' };
    }
  }

  // 2. Per-group counts.
  for (const group of groups) {
    const ids = new Set(availableChoices(group).map((c) => c.id));
    const picked = [...wanted].filter((id) => ids.has(id)).length;
    const { min, max } = effectiveBounds(group);
    if (picked < min) {
      return { groupName: group.name, message: `اختر من «${group.name}»` };
    }
    if (picked > max) {
      return {
        groupName: group.name,
        message:
          max === 1
            ? `«${group.name}»: اختر نوعاً واحداً فقط`
            : `«${group.name}»: أقصى عدد ${max} أنواع`,
      };
    }
  }

  return null;
}

/** Total price of a selection, in the same order the customer picked it. */
export function selectedChoices(
  groups: ProductOptionGroup[],
  selectedIds: string[]
): ProductOptionChoice[] {
  const byId = new Map(groups.flatMap((g) => g.option_choices ?? []).map((c) => [c.id, c]));
  return selectedIds
    .map((id) => byId.get(id))
    .filter((c): c is ProductOptionChoice => Boolean(c));
}