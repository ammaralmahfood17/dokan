/** Shared types for the POS (cashier) redesign — Polaris style. */

/** One cart line. `key` merges product + sorted addon ids so identical
 *  configurations stack. Logic lives in pos-client; components only render. */
export type PosLine = {
  key: string;
  productId: string;
  productName: string;
  unitPrice: number;
  quantity: number;
  optionIds: string[];
  addonLabels: string[];
};
