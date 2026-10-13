'use client';

import type { SupabaseClient } from '@supabase/supabase-js';
import type { Database } from '@/lib/database.types';
import type { ProductWithOptions } from '@/lib/types';
import { money, currencyDecimals } from '@/lib/utils';

/**
 * The product editor's save path, in one place.
 *
 * WHY THIS EXISTS (architecture review 2026-10-13, finding P0): saving a
 * product used to be up to ten separate statements issued from the modal —
 * insert/update the product, delete the option groups, re-insert each group and
 * its varieties, then re-read everything — with no transaction. A failure
 * halfway left a half-saved product (options deleted and not restored, or a
 * product created with no options at all). The write is now ONE call to
 * `upsert_product_with_options`, which commits all of it or none of it.
 *
 * The module is deliberately pure except for that single adapter call:
 * `validateOptionGroups` and `parseStockInput` are the rules the form and the
 * tests share, and `saveProduct` is the only thing that touches the network.
 */

/** max_select stored for a «متعدد» group. The server clamps it to the number
 *  of available varieties, so this is an upper bound, not a promise. */
export const UNLIMITED_MAX = 99;

/** One option group as the form holds it (merchant-facing switches). */
export type FormGroupInput = {
  name: string;
  required: boolean;
  single: boolean;
  choices: { name: string; price: string }[];
};

/** One option group as the RPC takes it (resolved selection rules). */
export type OptionGroupPayload = {
  name: string;
  min_select: number;
  max_select: number;
  choices: { name: string; price: number }[];
};

export type ProductFormValues = {
  name: string;
  nameEn: string;
  description: string;
  price: string;
  categoryId: string;
  isAvailable: boolean;
  imageUrl: string;
  /** Raw stock input: '' means untracked/unlimited. */
  stock: string;
};

export type SaveProductInput = {
  projectId: string;
  /** null on create; the product's id when editing. */
  productId: string | null;
  values: ProductFormValues;
  groups: FormGroupInput[];
  currency: string;
};

export type SaveProductResult =
  | { ok: true; product: ProductWithOptions }
  | { ok: false; message: string };

/** '' → null (untracked/unlimited). Otherwise the whole, non-negative count. */
export function parseStockInput(raw: string): number | null {
  const t = raw.trim();
  if (!t) return null;
  const n = Number(t);
  if (!Number.isFinite(n)) return null;
  return Math.max(0, Math.trunc(n));
}

/** Stock is either empty (untracked) or a whole, non-negative count. */
export function validateStockInput(raw: string): { ok: true } | { ok: false; message: string } {
  if (!raw.trim()) return { ok: true };
  const n = Number(raw);
  if (!Number.isInteger(n) || n < 0) {
    return { ok: false, message: 'عدد الحصص يجب أن يكون رقماً صحيحاً غير سالب' };
  }
  return { ok: true };
}

/**
 * Turn the form's groups into the RPC payload — or name the first thing that is
 * wrong, in the order the merchant would notice it.
 *
 * Rules, identical to the ones the modal applied inline before this module
 * existed:
 *  - a row with neither a name nor any variety is an untouched blank row: skip it
 *  - a named group with no variety is refused (it would render as nothing)
 *  - every variety needs a non-negative price
 */
export function validateOptionGroups(
  groups: FormGroupInput[],
  currency: string
): { ok: true; groups: OptionGroupPayload[] } | { ok: false; message: string } {
  const payload: OptionGroupPayload[] = [];

  for (const g of groups) {
    const groupName = g.name.trim();
    const choices = g.choices.filter((c) => c.name.trim().length > 0);

    if (!groupName && choices.length === 0) continue;
    if (!groupName) return { ok: false, message: 'اكتب اسم الخيار' };
    if (choices.length === 0) {
      return { ok: false, message: `أضف نوعاً واحداً على الأقل في «${groupName}»` };
    }

    for (const c of choices) {
      const choicePrice = Number(c.price);
      if (!Number.isFinite(choicePrice) || choicePrice < 0) {
        return { ok: false, message: `سعر «${c.name.trim()}» غير صالح` };
      }
    }

    payload.push({
      name: groupName,
      min_select: g.required ? 1 : 0,
      max_select: g.single ? 1 : UNLIMITED_MAX,
      choices: choices.map((c) => ({
        name: c.name.trim(),
        price: money(Number(c.price), currencyDecimals(currency)),
      })),
    });
  }

  return { ok: true, groups: payload };
}

/**
 * RPC error → the message the merchant sees.
 *
 * PostgREST returns a `raise exception 'CODE'` as `message: 'CODE'` (with the
 * SQLSTATE in `code`, e.g. `P0001`, or `42501` for the privilege path), so the
 * named code is read from `message` first and the SQLSTATE is the fallback.
 */
function messageForRpcError(error: { message?: string; code?: string } | null, editing: boolean): string {
  const named = (error?.message ?? '').trim();
  switch (named) {
    case 'NOT_AUTHORIZED':
    case 'PRODUCT_NOT_FOUND':
      return 'لا يمكن تعديل هذا المنتج';
    case 'CATEGORY_NOT_FOUND':
      return 'التصنيف المحدد لم يعد موجوداً';
    case 'NAME_REQUIRED':
      return 'الاسم مطلوب';
    case 'INVALID_PRICE':
      return 'السعر غير صالح — أدخل رقماً صحيحاً';
    case 'INVALID_STOCK':
    case 'INVALID_CHOICE_PRICE':
      return 'عدد الحصص يجب أن يكون رقماً صحيحاً غير سالب';
    case 'GROUP_NAME_REQUIRED':
      return 'اكتب اسم الخيار';
    case 'GROUP_NEEDS_CHOICE':
      return 'أضف نوعاً واحداً على الأقل في كل خيار';
    default:
      break;
  }
  // SQLSTATE-only fallback: an RLS refusal that never reached the guard.
  if (error?.code === '42501') return 'لا يمكن تعديل هذا المنتج';
  return editing ? 'فشل التحديث' : 'فشل الإضافة';
}

/**
 * Save the product and its whole option tree in one transaction.
 *
 * Called through the USER-scoped client: the RPC is `security invoker`, so RLS
 * (owner/manager) is the boundary and the RPC's own guard is the second line —
 * a service-role call would arrive with `auth.uid()` NULL and be refused.
 */
export async function saveProduct(
  supabase: SupabaseClient<Database>,
  input: SaveProductInput
): Promise<SaveProductResult> {
  const { projectId, productId, values, groups, currency } = input;
  const editing = productId !== null;

  const groupsResult = validateOptionGroups(groups, currency);
  if (!groupsResult.ok) return { ok: false, message: groupsResult.message };

  const { data, error } = await supabase.rpc('upsert_product_with_options', {
    p_project_id: projectId,
    p_product_id: productId,
    p_name: values.name.trim(),
    p_name_en: values.nameEn.trim() || null,
    p_description: values.description.trim() || null,
    p_price: money(Number(values.price), currencyDecimals(currency)),
    p_category_id: values.categoryId || null,
    p_is_available: values.isAvailable,
    p_image_url: values.imageUrl.trim() || null,
    p_stock: parseStockInput(values.stock),
    p_groups: groupsResult.groups,
  });

  if (error || !data) {
    return { ok: false, message: messageForRpcError(error, editing) };
  }

  return { ok: true, product: data as unknown as ProductWithOptions };
}
