import { describe, expect, it, vi } from 'vitest';
import {
  UNLIMITED_MAX,
  parseStockInput,
  saveProduct,
  validateOptionGroups,
  validateStockInput,
  type FormGroupInput,
} from './product-form';
import type { Database } from './database.types';
import type { SupabaseClient } from '@supabase/supabase-js';

/**
 * The product save path used to be ten un-transacted statements issued from the
 * modal. These tests pin the two halves of the replacement:
 *   1. the pure rules (group/price/stock validation) that produce the Arabic
 *      message the merchant sees, and
 *   2. `saveProduct`, which must send ONE `upsert_product_with_options` call and
 *      translate the RPC's named error codes back into those messages.
 */

function group(over: Partial<FormGroupInput> = {}): FormGroupInput {
  return {
    name: 'الحجم',
    required: false,
    single: true,
    choices: [{ name: 'صغير', price: '0' }, { name: 'كبير', price: '0.500' }],
    ...over,
  };
}

/** Minimal stand-in for the user-scoped Supabase client: only `rpc` is used. */
function fakeClient(result: { data?: unknown; error?: { message?: string; code?: string } | null }) {
  const rpc = vi.fn().mockResolvedValue({ data: result.data ?? null, error: result.error ?? null });
  return { client: { rpc } as unknown as SupabaseClient<Database>, rpc };
}

const values = {
  name: 'قهوة عربية',
  nameEn: '',
  description: '',
  price: '1.200',
  categoryId: '',
  isAvailable: true,
  imageUrl: '',
  stock: '',
};

describe('parseStockInput', () => {
  it('treats empty input as untracked (null)', () => {
    expect(parseStockInput('')).toBeNull();
    expect(parseStockInput('   ')).toBeNull();
  });
  it('keeps a whole, non-negative count', () => {
    expect(parseStockInput('12')).toBe(12);
    expect(parseStockInput(' 3 ')).toBe(3);
  });
  it('never returns a negative or fractional count', () => {
    expect(parseStockInput('-4')).toBe(0);
    expect(parseStockInput('2.9')).toBe(2);
    expect(parseStockInput('abc')).toBeNull();
  });
});

describe('validateStockInput', () => {
  it('accepts empty (untracked) and whole counts', () => {
    expect(validateStockInput('').ok).toBe(true);
    expect(validateStockInput('7').ok).toBe(true);
  });
  it('refuses fractions and negatives with the merchant-facing message', () => {
    for (const bad of ['1.5', '-1', 'x']) {
      const result = validateStockInput(bad);
      expect(result.ok).toBe(false);
      if (!result.ok) {
        expect(result.message).toBe('عدد الحصص يجب أن يكون رقماً صحيحاً غير سالب');
      }
    }
  });
});

describe('validateOptionGroups', () => {
  it('skips a completely blank row (untouched in the UI)', () => {
    const result = validateOptionGroups([{ name: '  ', required: false, single: true, choices: [{ name: '', price: '0' }] }], 'BHD');
    expect(result).toEqual({ ok: true, groups: [] });
  });

  it('maps the merchant switches onto min_select/max_select', () => {
    const result = validateOptionGroups(
      [
        group({ name: 'إلزامي أحادي', required: true, single: true }),
        group({ name: 'اختياري متعدد', required: false, single: false }),
      ],
      'BHD'
    );
    expect(result.ok).toBe(true);
    if (result.ok) {
      expect(result.groups.map((g) => [g.min_select, g.max_select])).toEqual([
        [1, 1],
        [0, UNLIMITED_MAX],
      ]);
    }
  });

  it('rounds choice prices with the project currency decimals', () => {
    const bhd = validateOptionGroups([group({ choices: [{ name: 'صغير', price: '0.12345' }] })], 'BHD');
    const sar = validateOptionGroups([group({ choices: [{ name: 'صغير', price: '0.12345' }] })], 'SAR');
    expect(bhd.ok && bhd.groups[0].choices[0].price).toBe(0.123);
    expect(sar.ok && sar.groups[0].choices[0].price).toBe(0.12);
  });

  it('names the first problem, in the order a merchant would notice it', () => {
    const noName = validateOptionGroups([group({ name: '', choices: [{ name: 'صغير', price: '0' }] })], 'BHD');
    expect(noName).toEqual({ ok: false, message: 'اكتب اسم الخيار' });

    const noChoices = validateOptionGroups([group({ name: 'الحجم', choices: [{ name: '  ', price: '0' }] })], 'BHD');
    expect(noChoices).toEqual({ ok: false, message: 'أضف نوعاً واحداً على الأقل في «الحجم»' });

    const badPrice = validateOptionGroups([group({ choices: [{ name: 'كبير', price: '-1' }] })], 'BHD');
    expect(badPrice).toEqual({ ok: false, message: 'سعر «كبير» غير صالح' });
  });

  it('drops varieties whose name is empty but keeps the rest', () => {
    const result = validateOptionGroups(
      [group({ choices: [{ name: 'صغير', price: '0' }, { name: '   ', price: '9' }] })],
      'BHD'
    );
    expect(result.ok && result.groups[0].choices).toHaveLength(1);
  });
});

describe('saveProduct', () => {
  const base = { projectId: 'p1', values, groups: [group()], currency: 'BHD' };

  it('sends exactly one RPC call and returns the saved product', async () => {
    const { client, rpc } = fakeClient({ data: { id: 'prod-1', name: 'قهوة عربية' } });
    const result = await saveProduct(client, { ...base, productId: null });

    expect(rpc).toHaveBeenCalledTimes(1);
    expect(rpc.mock.calls[0][0]).toBe('upsert_product_with_options');
    expect(rpc.mock.calls[0][1]).toMatchObject({
      p_project_id: 'p1',
      p_product_id: null,
      p_name: 'قهوة عربية',
      p_price: 1.2,
      p_stock: null,
      p_is_available: true,
      p_image_url: null,
      p_category_id: null,
    });
    expect(result).toEqual({ ok: true, product: { id: 'prod-1', name: 'قهوة عربية' } });
  });

  it('never calls the RPC when a group rule fails', async () => {
    const { client, rpc } = fakeClient({ data: {} });
    // A named group with no variety is refused; a fully blank row is skipped,
    // so this must be the *named* variant to exercise the guard.
    const result = await saveProduct(client, {
      ...base,
      productId: 'prod-1',
      groups: [group({ name: 'الحجم', choices: [{ name: '   ', price: '0' }] })],
    });
    expect(rpc).not.toHaveBeenCalled();
    expect(result).toEqual({ ok: false, message: 'أضف نوعاً واحداً على الأقل في «الحجم»' });
  });

  it('maps the RPC error shapes onto the merchant-facing messages', async () => {
    // PostgREST puts a `raise exception 'CODE'` in `message`; the SQLSTATE rides
    // along in `code`, so both shapes have to be understood.
    const cases: [{ message?: string; code?: string }, boolean, string][] = [
      [{ message: 'NOT_AUTHORIZED', code: '42501' }, true, 'لا يمكن تعديل هذا المنتج'],
      [{ message: 'PRODUCT_NOT_FOUND', code: 'P0001' }, true, 'لا يمكن تعديل هذا المنتج'],
      [{ code: '42501' }, true, 'لا يمكن تعديل هذا المنتج'],
      [{ message: 'GROUP_NEEDS_CHOICE' }, false, 'أضف نوعاً واحداً على الأقل في كل خيار'],
      [{ message: 'unexpected failure' }, false, 'فشل الإضافة'],
      [{ message: 'unexpected failure' }, true, 'فشل التحديث'],
    ];
    for (const [error, editing, expected] of cases) {
      const { client } = fakeClient({ error });
      const result = await saveProduct(client, { ...base, productId: editing ? 'prod-1' : null });
      expect(result).toEqual({ ok: false, message: expected });
    }
  });

  it('reports a missing row from the RPC as a failure, never as success', async () => {
    const { client } = fakeClient({ data: null, error: null });
    const result = await saveProduct(client, { ...base, productId: 'prod-1' });
    expect(result.ok).toBe(false);
  });
});
