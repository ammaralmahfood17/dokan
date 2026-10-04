// Per-product stock rules — pure so the menu, the POS and the server-side
// pricing path all answer "can this be ordered?" the same way.
//
// Model (migration 0018): `stock` is NULL for an UNTRACKED product (unlimited —
// every product that existed before the feature) and a non-negative integer for
// a tracked one. `is_available` stays the merchant's manual switch and is NOT
// touched by stock; a tracked product that hits 0 renders as sold out exactly
// like an unavailable one.

/** The slice of a product these rules need. `stock` may be absent on rows
 *  selected before the feature shipped, which is treated as untracked. */
export type StockedProduct = {
  is_available: boolean;
  stock?: number | null;
};

/** Remaining portions, or null when untracked/unlimited. */
export function remainingStock(p: StockedProduct): number | null {
  const stock = p.stock ?? null;
  if (stock === null || !Number.isFinite(stock)) return null;
  return Math.max(0, Math.trunc(stock));
}

/** True when the customer must not be able to order this right now. */
export function isSoldOut(p: StockedProduct): boolean {
  if (!p.is_available) return true;
  const left = remainingStock(p);
  return left !== null && left <= 0;
}

/** Most units one order line may hold. Infinity when untracked. */
export function maxOrderableQty(p: StockedProduct): number {
  const left = remainingStock(p);
  return left === null ? Number.POSITIVE_INFINITY : left;
}

/**
 * Show «باقي N» only when the number is small enough to be useful — a badge on
 * every tracked product would just be noise, and a large count is not
 * something the customer needs to think about.
 */
export const LOW_STOCK_THRESHOLD = 5;

/** The count to surface to the customer, or null when there is nothing to say. */
export function lowStockLabel(p: StockedProduct): number | null {
  const left = remainingStock(p);
  if (left === null || left <= 0 || left > LOW_STOCK_THRESHOLD) return null;
  return left;
}
