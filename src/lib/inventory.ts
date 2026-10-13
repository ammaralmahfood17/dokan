import type { IngredientUnit, InventoryMovementType } from '@/lib/types';

/**
 * The inventory page's rules and labels, as pure functions.
 *
 * WHY THIS EXISTS (architecture review 2026-10-13, wave 4): every rule on this
 * page — what makes an ingredient valid, what a stock movement may say, what a
 * recipe line may hold — was written inline in the submit handler of a 676-line
 * client component. Nothing was tested, including the two rules that protect
 * real stock figures: a receive must be positive, and a recipe may not list the
 * same ingredient twice (the second line would silently double-deduct).
 */

export const UNIT_LABELS: Record<IngredientUnit, string> = {
  g: 'غرام',
  ml: 'مل',
  each: 'حبة',
};

export const MOVEMENT_LABELS: Record<InventoryMovementType, string> = {
  receive: 'استلام',
  adjustment: 'تسوية',
  consume: 'استهلاك طلب',
  restore: 'إرجاع إلغاء',
};

/** Units a NEW ingredient may be created with (an edit keeps its unit). */
export const INGREDIENT_UNITS: IngredientUnit[] = ['g', 'ml', 'each'];

/** Quantities up to 3 decimals, Latin digits (the page renders `en` numbers). */
export function quantity(value: number | string): string {
  return Number(value).toLocaleString('en', { maximumFractionDigits: 3 });
}

type Stocked = { quantity_on_hand: number | string; reorder_point: number | string };

/** At or below the reorder point → the row is flagged in the list. */
export function isLowStock(ingredient: Stocked): boolean {
  return Number(ingredient.quantity_on_hand) <= Number(ingredient.reorder_point);
}

/** How many ingredients need attention (the header badge). */
export function lowStockCount(ingredients: Stocked[]): number {
  return ingredients.filter(isLowStock).length;
}

/** Is this ingredient already used by another line of the recipe being edited? */
export function prevRecipeUses(
  lines: { ingredient_id: string; quantity: string }[],
  currentIndex: number,
  ingredientId: string
): boolean {
  return lines.some((line, index) => index !== currentIndex && line.ingredient_id === ingredientId);
}

export type Validated<T> = { ok: true; value: T } | { ok: false; message: string };

/**
 * An ingredient needs a name and a non-negative reorder point; a NEW one also
 * needs a unit from the allowed list (an edit keeps the unit it already has, so
 * its value is not part of the payload).
 */
export function validateIngredientInput(input: {
  name: string;
  reorderPoint: number;
  unit: string;
  editing: boolean;
}): Validated<{ name: string; reorder_point: number; unit: IngredientUnit | null }> {
  const name = input.name.trim();
  if (!name || !Number.isFinite(input.reorderPoint) || input.reorderPoint < 0) {
    return { ok: false, message: 'أدخل اسمًا ونقطة إعادة طلب صحيحة' };
  }
  if (!input.editing) {
    if (!(INGREDIENT_UNITS as string[]).includes(input.unit)) {
      return { ok: false, message: 'وحدة القياس غير صالحة' };
    }
    return { ok: true, value: { name, reorder_point: input.reorderPoint, unit: input.unit as IngredientUnit } };
  }
  // `unit: null` means "keep the unit this ingredient already has" — the edit
  // payload does not carry one.
  return { ok: true, value: { name, reorder_point: input.reorderPoint, unit: null } };
}

/** A supplier needs a name and nothing else — empty optional fields are null. */
export function validateSupplierInput(input: { name: string }): Validated<{ name: string }> {
  const name = input.name.trim();
  if (!name) return { ok: false, message: 'أدخل اسم المورّد' };
  return { ok: true, value: { name } };
}

/**
 * A stock movement: non-zero, and a `receive` may not be negative (a negative
 * receipt is a correction, and corrections go through `adjustment`).
 */
export function validateMovementInput(input: {
  movementType: 'receive' | 'adjustment';
  amount: number;
}): Validated<{ movementType: 'receive' | 'adjustment'; amount: number }> {
  const { movementType, amount } = input;
  if (!Number.isFinite(amount) || amount === 0 || (movementType === 'receive' && amount < 0)) {
    return { ok: false, message: 'أدخل كمية صحيحة؛ الاستلام يجب أن يكون موجبًا' };
  }
  return { ok: true, value: { movementType, amount } };
}

/**
 * A recipe: every line needs an ingredient and a positive quantity, and no
 * ingredient may appear twice — the second line would deduct it twice for one
 * order, which is invisible in the UI and wrong in the ledger.
 */
export function validateRecipeLines(
  lines: { ingredient_id: string; quantity: string }[]
): Validated<{ ingredient_id: string; quantity: number }[]> {
  const parsed = lines.map((line) => ({
    ingredient_id: line.ingredient_id,
    quantity: Number(line.quantity),
  }));
  const invalid = parsed.some(
    (line) => !line.ingredient_id || !Number.isFinite(line.quantity) || line.quantity <= 0
  );
  const duplicated = new Set(parsed.map((line) => line.ingredient_id)).size !== parsed.length;
  if (invalid || duplicated) {
    return { ok: false, message: 'أكمل كل المكوّنات والكميات، ولا تكرر المكوّن' };
  }
  return { ok: true, value: parsed };
}
