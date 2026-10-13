'use client';

import { useState, type FormEvent } from 'react';
import { useRouter } from 'next/navigation';
import { toast } from 'sonner';
import { createClient } from '@/lib/supabase/client';
import type { Json } from '@/lib/database.types';
import type { Ingredient, IngredientUnit, Product, Supplier } from '@/lib/types';
import {
  validateIngredientInput,
  validateMovementInput,
  validateRecipeLines,
  validateSupplierInput,
} from '@/lib/inventory';

type ProductOption = Pick<Product, 'id' | 'project_id' | 'name' | 'name_en' | 'stock'>;

/**
 * The inventory page's four writes, in one place.
 *
 * WHY THIS EXISTS (architecture review 2026-10-13, wave 4): they were four
 * inline handlers in a 676-line client component, each mixing FormData reading,
 * validation, the Supabase call, the toast and `router.refresh()`. The rules
 * are now `lib/inventory.ts` (pure, tested) and this is the adapter: validate →
 * write → report → refresh.
 *
 * Each action returns `true` when the write landed, so the caller can close its
 * own dialog — the hook deliberately does not own dialog state.
 */
export function useInventoryActions({ projectId }: { projectId: string }) {
  const router = useRouter();
  const [busy, setBusy] = useState(false);

  async function saveIngredient(
    event: FormEvent<HTMLFormElement>,
    editing: Ingredient | null
  ): Promise<boolean> {
    event.preventDefault();
    if (busy) return false;
    const form = new FormData(event.currentTarget);
    const checked = validateIngredientInput({
      name: String(form.get('name') ?? ''),
      reorderPoint: Number(form.get('reorder_point') ?? 0),
      unit: String(form.get('unit') ?? 'g'),
      editing: Boolean(editing),
    });
    if (!checked.ok) {
      toast.error(checked.message);
      return false;
    }

    const supplierId = String(form.get('supplier_id') ?? '') || null;
    const supplierSku = String(form.get('supplier_sku') ?? '').trim() || null;
    // Only reaches the insert below, and the validator refuses the call unless
    // this value is one of INGREDIENT_UNITS — hence the narrowing cast.
    const unit = String(form.get('unit') ?? 'g') as IngredientUnit;

    setBusy(true);
    const supabase = createClient();
    const result = editing
      ? await supabase
          .from('ingredients')
          .update({
            name: checked.value.name,
            reorder_point: checked.value.reorder_point,
            supplier_id: supplierId,
            supplier_sku: supplierSku,
          })
          .eq('id', editing.id)
          .eq('project_id', projectId)
      : await supabase.from('ingredients').insert({
          project_id: projectId,
          name: checked.value.name,
          unit,
          reorder_point: checked.value.reorder_point,
          supplier_id: supplierId,
          supplier_sku: supplierSku,
        });
    setBusy(false);

    if (result.error) {
      toast.error('تعذر حفظ المكوّن');
      return false;
    }
    toast.success(editing ? 'تم تحديث المكوّن' : 'تمت إضافة المكوّن');
    router.refresh();
    return true;
  }

  async function saveSupplier(
    event: FormEvent<HTMLFormElement>,
    editing: Supplier | null
  ): Promise<boolean> {
    event.preventDefault();
    if (busy) return false;
    const form = new FormData(event.currentTarget);
    const checked = validateSupplierInput({ name: String(form.get('name') ?? '') });
    if (!checked.ok) {
      toast.error(checked.message);
      return false;
    }
    const contactName = String(form.get('contact_name') ?? '').trim() || null;
    const email = String(form.get('email') ?? '').trim() || null;
    const phone = String(form.get('phone') ?? '').trim() || null;

    setBusy(true);
    const supabase = createClient();
    const result = editing
      ? await supabase
          .from('suppliers')
          .update({ name: checked.value.name, contact_name: contactName, email, phone })
          .eq('id', editing.id)
          .eq('project_id', projectId)
      : await supabase
          .from('suppliers')
          .insert({ project_id: projectId, name: checked.value.name, contact_name: contactName, email, phone });
    setBusy(false);

    if (result.error) {
      toast.error('تعذر حفظ بيانات المورّد');
      return false;
    }
    toast.success(editing ? 'تم تحديث بيانات المورّد' : 'تمت إضافة المورّد');
    router.refresh();
    return true;
  }

  async function saveMovement(
    event: FormEvent<HTMLFormElement>,
    target: Ingredient | null
  ): Promise<boolean> {
    event.preventDefault();
    if (!target || busy) return false;
    const form = new FormData(event.currentTarget);
    const checked = validateMovementInput({
      movementType: String(form.get('movement_type')) as 'receive' | 'adjustment',
      amount: Number(form.get('quantity')),
    });
    if (!checked.ok) {
      toast.error(checked.message);
      return false;
    }
    const notes = String(form.get('notes') ?? '').trim();

    setBusy(true);
    const supabase = createClient();
    const { error } = await supabase.rpc('adjust_ingredient_stock', {
      p_ingredient_id: target.id,
      p_movement_type: checked.value.movementType,
      p_quantity: checked.value.amount,
      p_notes: notes || null,
    });
    setBusy(false);
    if (error) {
      toast.error(
        error.message.includes('INSUFFICIENT_INGREDIENT_STOCK')
          ? 'لا يمكن أن يصبح الرصيد أقل من صفر'
          : 'تعذر تسجيل حركة المخزون'
      );
      return false;
    }
    toast.success('تم تحديث رصيد المخزون');
    router.refresh();
    return true;
  }

  async function saveRecipe(
    event: FormEvent<HTMLFormElement>,
    product: ProductOption | null,
    lines: { ingredient_id: string; quantity: string }[]
  ): Promise<boolean> {
    event.preventDefault();
    if (!product || busy) return false;
    const checked = validateRecipeLines(lines);
    if (!checked.ok) {
      toast.error(checked.message);
      return false;
    }

    setBusy(true);
    const supabase = createClient();
    const { error } = await supabase.rpc('replace_product_recipe', {
      p_product_id: product.id,
      p_lines: checked.value as Json,
    });
    setBusy(false);
    if (error) {
      toast.error('تعذر حفظ الوصفة');
      return false;
    }
    // An empty list is not a failure: it means "stop tracking this product".
    toast.success(checked.value.length ? 'تم حفظ الوصفة' : 'تم إيقاف تتبّع مكونات المنتج');
    router.refresh();
    return true;
  }

  return { busy, saveIngredient, saveSupplier, saveMovement, saveRecipe };
}
