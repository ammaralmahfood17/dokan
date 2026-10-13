import { currencyDecimals, money } from '@/lib/utils';
import { isSoldOut, maxOrderableQty } from '@/lib/product-stock';
import { selectedChoices } from '@/lib/product-options';
import type { Product, ProductOptionGroup, ProductWithOptions } from '@/lib/types';

// `needsPicker` (does this product have anything to choose?) is the menu's rule
// and is identical here: a group with an available variety. Reused, not copied.

/**
 * The POS (cashier) cart rules, as pure functions.
 *
 * WHY THIS EXISTS (architecture review 2026-10-13, wave 4): these sat inline in
 * a 659-line client component, in the same file as the picker, the shortcuts,
 * "repeat last order", the submit path and the whole layout. They are the rules
 * that decide what a cashier can ring up — and a cashier cannot wait for a
 * round trip to find out a quantity is over stock.
 *
 * What is NOT duplicated here: the option-selection rule is the menu's
 * `toggleOptionSelection`, and the cart total is the menu's `cartTotal`. A POS
 * line and a menu line differ only in shape (option ids + labels instead of an
 * `addons` snapshot), so the maths is shared and the shapes are not.
 */

/** The slice of a POS line these rules need. */
export type PosLineLike = {
  key: string;
  productId: string;
  productName: string;
  unitPrice: number;
  quantity: number;
  optionIds: string[];
  addonLabels: string[];
};

/**
 * Identity of a POS line: the product plus the chosen varieties, order-
 * insensitive.
 *
 * NOTE the POS has no free-text per-line note (the cashier's note is on the
 * whole order), which is why this key has one segment fewer than the menu's
 * `lineKey`. Two different formats on purpose — do not "unify" them.
 */
export function posLineKey(productId: string, optionIds: readonly string[]): string {
  return `${productId}:${[...optionIds].sort().join(',')}`;
}

type SellableProduct = Pick<Product, 'id' | 'name' | 'name_en' | 'is_available' | 'sort_order'> & {
  stock?: number | null;
};

/**
 * What the cashier may sell, most-ordered first.
 *
 * Frequency (last 7 days) leads and `sort_order` breaks ties, so the grid is
 * stable: a product with no history keeps a fixed position instead of drifting
 * between renders.
 */
export function availablePosProducts<T extends SellableProduct>(
  products: T[],
  frequency: Record<string, number> = {}
): T[] {
  return products
    .filter((p) => !isSoldOut(p))
    .slice()
    .sort(
      (a, b) =>
        (frequency[b.id] ?? 0) - (frequency[a.id] ?? 0) || a.sort_order - b.sort_order
    );
}

/** Cashier search: matches either language's name. */
export function searchPosProducts<T extends { name: string; name_en?: string | null }>(
  products: T[],
  query: string
): T[] {
  const q = query.trim().toLowerCase();
  if (!q) return products;
  return products.filter(
    (p) => p.name.toLowerCase().includes(q) || (p.name_en ?? '').toLowerCase().includes(q)
  );
}

export type PosStockCheck = { ok: true } | { ok: false; message: string };

/**
 * May this product go into the cart, `qty` more of it?
 *
 * Stock (migration 0018): a tracked product with nothing left reads as
 * unavailable, and no sale may exceed what remains — the SERVER rejects the
 * whole order at checkout, so it has to be caught here where the cashier can
 * react.
 */
export function posStockCheck(
  product: SellableProduct,
  alreadyInCart: number,
  qty: number
): PosStockCheck {
  if (isSoldOut(product)) return { ok: false, message: 'هذا الصنف غير متوفر' };
  if (alreadyInCart + qty > maxOrderableQty(product)) {
    return { ok: false, message: 'الكمية المطلوبة أكثر من المتوفر' };
  }
  return { ok: true };
}

/** Price of a POS line: base price + the chosen varieties, at the project's decimals. */
export function buildPosLine(
  product: ProductWithOptions,
  optionIds: string[],
  addonLabels: string[],
  qty: number,
  currency: string
): PosLineLike {
  const dec = currencyDecimals(currency);
  const optionTotal = money(
    selectedChoices(product.option_groups || [], optionIds).reduce((sum, c) => sum + Number(c.price), 0),
    dec
  );
  return {
    key: posLineKey(product.id, optionIds),
    productId: product.id,
    productName: product.name,
    unitPrice: money(Number(product.price) + optionTotal, dec),
    quantity: qty,
    optionIds,
    addonLabels,
  };
}

/**
 * Add `qty` of a line: stack onto the matching configuration, otherwise append.
 *
 * Unlike the menu (which always adds one at a time), the POS adds a whole
 * quantity — "repeat last order" restores each line with its original count.
 */
export function addPosLine<T extends PosLineLike>(lines: T[], line: T, qty: number): T[] {
  const existing = lines.find((l) => l.key === line.key);
  if (existing) {
    return lines.map((l) => (l.key === line.key ? { ...l, quantity: l.quantity + qty } : l));
  }
  return [...lines, { ...line, quantity: qty }];
}

/** Nudge a line's quantity; a line that reaches 0 is dropped. */
export function changePosQty<T extends PosLineLike>(lines: T[], key: string, delta: number): T[] {
  return lines
    .map((l) => (l.key === key ? { ...l, quantity: l.quantity + delta } : l))
    .filter((l) => l.quantity > 0);
}

/** Set a line's quantity outright (the cart panel's quantity field). */
export function setPosQty<T extends PosLineLike>(lines: T[], key: string, qty: number): T[] {
  return lines.map((l) => (l.key === key ? { ...l, quantity: qty } : l));
}

/** The label list stored on the line for the cart panel to render. */
export function posAddonLabels(groups: ProductOptionGroup[], optionIds: string[]): string[] {
  return selectedChoices(groups, optionIds).map((c) => c.name);
}
