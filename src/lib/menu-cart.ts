import { currencyDecimals, money } from '@/lib/utils';
import {
  availableChoices,
  effectiveBounds,
  selectedChoices,
  validateOptionSelection,
} from '@/lib/product-options';
import type {
  CartLine,
  Category,
  OrderItemOption,
  ProductOptionGroup,
  ProductWithOptions,
} from '@/lib/types';

/**
 * The public menu's cart and browsing rules, as pure functions.
 *
 * WHY THIS EXISTS (architecture review 2026-10-13, wave 4): `menu-client.tsx`
 * is the busiest component in the product — every QR scan lands on it — and it
 * held these rules inline in a 1038-line client component with no unit coverage
 * at all. The rules are the part a customer feels when they are wrong: a cart
 * line that does not merge, a sold-out item that gets queued, a quick-note that
 * loses its separator, an option group that lets you pick three when it allows
 * one.
 *
 * Everything here is pure, so it is tested directly (menu-cart.test.ts) instead
 * of only through a browser.
 */

/**
 * Identity of a cart line: the product, the chosen varieties (order-insensitive)
 * and the note.
 *
 * A product added without the picker (quick-add) must land on the SAME key as
 * the same product added through the picker with nothing selected — otherwise
 * the customer sees two lines for one item. Both produce `<id>::`, which is why
 * every caller must build the key through this function and never by hand.
 */
export function lineKey(productId: string, optionIds: readonly string[], notes: string): string {
  return `${productId}:${[...optionIds].sort().join(',')}:${notes.trim()}`;
}

/**
 * Cart total, rounded to the project currency's decimals.
 *
 * Typed structurally, not on `CartLine`: the POS cart has its own line shape and
 * must not grow a second, drifting definition of "total".
 */
export function cartTotal(lines: { unitPrice: number; quantity: number }[], currency: string): number {
  return money(
    lines.reduce((sum, l) => sum + l.unitPrice * l.quantity, 0),
    currencyDecimals(currency)
  );
}

/** Number of units in the cart (not lines). */
export function cartItemCount(lines: { quantity: number }[]): number {
  return lines.reduce((sum, l) => sum + l.quantity, 0);
}

/**
 * Units per product — an O(1) lookup for the product grid.
 *
 * The old `qtyOf(id)` filter ran once per product on every render, so a cart
 * change cost O(products × lines); the menu is rebuilt on every tap.
 */
export function qtyByProduct(lines: { productId: string; quantity: number }[]): Map<string, number> {
  const byProduct = new Map<string, number>();
  for (const l of lines) byProduct.set(l.productId, (byProduct.get(l.productId) ?? 0) + l.quantity);
  return byProduct;
}

/** Units of ONE product currently in the cart. */
export function productQtyInCart(
  lines: { productId: string; quantity: number }[],
  productId: string
): number {
  return lines.filter((l) => l.productId === productId).reduce((sum, l) => sum + l.quantity, 0);
}

/** The key of the most recently added line for a product (the stepper's target). */
export function lastProductLineKey(lines: CartLine[], productId: string): string | undefined {
  return [...lines].reverse().find((l) => l.productId === productId)?.key;
}

/**
 * Add a line: increment the matching one, otherwise append. Returns the new
 * array plus whether it was an increment, because the toast says «زادت الكمية»
 * for one and «أُضيف إلى السلة» for the other.
 */
export function addLine(lines: CartLine[], line: CartLine): { lines: CartLine[]; incremented: boolean } {
  const existing = lines.find((l) => l.key === line.key);
  if (existing) {
    return {
      lines: lines.map((l) => (l.key === line.key ? { ...l, quantity: l.quantity + 1 } : l)),
      incremented: true,
    };
  }
  return { lines: [...lines, line], incremented: false };
}

/** Change one line's quantity; a line that reaches 0 is dropped. */
export function changeQuantity(lines: CartLine[], key: string, delta: number): CartLine[] {
  return lines
    .map((l) => (l.key === key ? { ...l, quantity: l.quantity + delta } : l))
    .filter((l) => l.quantity > 0);
}

/** Category id + instant search, matching either language's name. */
export function filterMenuProducts(
  products: ProductWithOptions[],
  categoryId: string | 'all',
  query: string
): ProductWithOptions[] {
  let list = products;
  if (categoryId !== 'all') list = list.filter((p) => p.category_id === categoryId);

  const q = query.trim().toLowerCase();
  if (!q) return list;
  return list.filter(
    (p) => p.name.toLowerCase().includes(q) || (p.name_en ?? '').toLowerCase().includes(q)
  );
}

/** Filtered products bucketed by category, computed once per list change. */
export function groupByCategory(products: ProductWithOptions[]): Map<string, ProductWithOptions[]> {
  const byCategory = new Map<string, ProductWithOptions[]>();
  for (const p of products) {
    if (!p.category_id) continue; // uncategorized is handled separately
    const arr = byCategory.get(p.category_id) ?? [];
    arr.push(p);
    byCategory.set(p.category_id, arr);
  }
  return byCategory;
}

/** Only the categories that actually have a product in the current view. */
export function categoriesWithProducts(
  categories: Category[],
  byCategory: Map<string, ProductWithOptions[]>
): Category[] {
  return categories.filter((c) => (byCategory.get(c.id)?.length ?? 0) > 0);
}

/** Products with no category (the category was deleted → SET NULL): stay visible. */
export function uncategorizedProducts(products: ProductWithOptions[]): ProductWithOptions[] {
  return products.filter((p) => !p.category_id);
}

/**
 * Append/remove a quick-note phrase, keeping the 200-char cap.
 *
 * The removal path has to tidy the separators it leaves behind (`بدون سكر،` →
 * ``), which is exactly the sort of thing a test should pin rather than a
 * customer should discover.
 */
export function toggleQuickNoteText(prev: string, note: string): string {
  if (prev.includes(note)) {
    return prev
      .replace(note, '')
      .replace(/،،+/g, '،')
      .replace(/^[،\s]+/, '')
      .replace(/[،\s]+$/, '');
  }
  const next = prev.trim() ? `${prev}، ${note}` : note;
  return next.length <= 200 ? next : prev;
}

/**
 * Toggle a variety: a single-choice group replaces, a multi group appends up to
 * its bound (and a tap at the bound is ignored rather than dropping the choice).
 */
export function toggleOptionSelection(
  prev: string[],
  group: ProductOptionGroup,
  choiceId: string
): string[] {
  const bounds = effectiveBounds(group);
  const groupIds = new Set(availableChoices(group).map((c) => c.id));
  if (prev.includes(choiceId)) return prev.filter((id) => id !== choiceId);
  if (bounds.max === 1) return [...prev.filter((id) => !groupIds.has(id)), choiceId];
  const picked = availableChoices(group).filter((c) => prev.includes(c.id)).length;
  if (picked >= bounds.max) return prev;
  return [...prev, choiceId];
}

export type BuiltLine = { ok: true; line: CartLine } | { ok: false; message: string };

/**
 * Build the cart line for a picker selection: validate the group rules, price
 * the varieties, round the unit price with the project's decimals.
 *
 * The picker also disables its button while a rule is unmet; the validation
 * runs again here so a stale render can never add a half-configured line.
 */
export function buildPickedLine(
  product: ProductWithOptions,
  groups: ProductOptionGroup[],
  selectedOptionIds: string[],
  notesRaw: string,
  currency: string
): BuiltLine {
  const violation = validateOptionSelection(groups, selectedOptionIds);
  if (violation) return { ok: false, message: violation.message };

  const dec = currencyDecimals(currency);
  const options: OrderItemOption[] = selectedChoices(groups, selectedOptionIds).map((c) => ({
    id: c.id,
    name: c.name,
    price: money(Number(c.price), dec),
  }));
  const optionTotal = money(
    options.reduce((sum, o) => sum + o.price, 0),
    dec
  );
  const notes = notesRaw.trim();

  return {
    ok: true,
    line: {
      key: lineKey(product.id, options.map((o) => o.id), notes),
      productId: product.id,
      productName: product.name,
      unitPrice: money(Number(product.price) + optionTotal, dec),
      quantity: 1,
      addons: options,
      notes,
    },
  };
}

/** The line a quick-add produces: no varieties, no note, the product's price. */
export function buildQuickLine(product: ProductWithOptions, currency: string): CartLine {
  return {
    key: lineKey(product.id, [], ''),
    productId: product.id,
    productName: product.name,
    unitPrice: money(Number(product.price), currencyDecimals(currency)),
    quantity: 1,
    addons: [],
    notes: '',
  };
}

/** Does this product have anything to choose? If so, quick-add must open the picker. */
export function needsPicker(product: ProductWithOptions): boolean {
  return (product.option_groups || []).some((g) => availableChoices(g).length > 0);
}
