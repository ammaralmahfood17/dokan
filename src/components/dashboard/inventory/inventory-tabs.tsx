'use client';

import { ArrowDownToLine, ArrowUpFromLine, Pencil, Plus } from 'lucide-react';
import { Button } from '@/components/ui/button';
import { EmptyState } from '@/components/ui/empty-state';
import { MOVEMENT_LABELS, UNIT_LABELS, isLowStock, quantity } from '@/lib/inventory';
import type {
  Ingredient,
  InventoryMovement,
  Product,
  ProductIngredient,
  Supplier,
} from '@/lib/types';

/**
 * The four inventory tabs, extracted verbatim from `inventory-client.tsx`
 * (architecture review 2026-10-13, wave 4 phase b).
 *
 * Presentational: every one of them receives its data and callbacks. The rules
 * they apply come from `lib/inventory` (`isLowStock`, `quantity`, the movement
 * labels) — the same module the write path validates with, so a row cannot be
 * flagged low by the list and accepted as fine by the form.
 *
 */

type ProductOption = Pick<Product, 'id' | 'project_id' | 'name' | 'name_en' | 'stock'>;

export function IngredientsTab({
  ingredients,
  suppliers,
  onNewIngredient,
  onOpenStockMovement,
  onEditIngredient,
}: {
  ingredients: Ingredient[];
  suppliers: Supplier[];
  onNewIngredient: () => void;
  onOpenStockMovement: (ingredient: Ingredient) => void;
  onEditIngredient: (ingredient: Ingredient) => void;
}) {
  if (!ingredients.length) {
    return (
      <EmptyState
        title="ما فيه مكونات مسجلة"
        description="أضف المكونات أولًا، ثم اربطها بوصفات المنتجات لتفعيل الخصم التلقائي."
        action={
          <Button onClick={onNewIngredient}>
            <Plus className="h-4 w-4" />
            أضف أول مكوّن
          </Button>
        }
      />
    );
  }

  return (
    <div className="divide-y divide-[var(--color-border)]">
      {ingredients.map((ingredient) => {
        const low = isLowStock(ingredient);
        const supplier = suppliers.find((item) => item.id === ingredient.supplier_id);
        return (
          <div key={ingredient.id} className="flex flex-wrap items-center justify-between gap-3 p-4">
            <div className="min-w-[180px] flex-1">
              <div className="flex items-center gap-2">
                <span className="font-bold">{ingredient.name}</span>
                {low && (
                  <span className="rounded-full bg-[var(--color-danger-tint)] px-2 py-0.5 text-caption font-semibold text-[var(--color-danger)]">
                    إعادة الطلب
                  </span>
                )}
              </div>
              <div className="mt-1 text-xs text-[var(--color-text-secondary)]">
                {supplier?.name ?? 'بدون مورّد'}
                {ingredient.supplier_sku ? ` · SKU ${ingredient.supplier_sku}` : ''}
              </div>
            </div>
            <div className="min-w-28">
              <div className="text-xs text-[var(--color-text-secondary)]">الرصيد</div>
              <div className="font-bold" dir="ltr">
                {quantity(ingredient.quantity_on_hand)} {UNIT_LABELS[ingredient.unit]}
              </div>
            </div>
            <div className="min-w-28">
              <div className="text-xs text-[var(--color-text-secondary)]">نقطة الطلب</div>
              <div className="font-semibold" dir="ltr">
                {quantity(ingredient.reorder_point)} {UNIT_LABELS[ingredient.unit]}
              </div>
            </div>
            <div className="flex flex-wrap gap-2">
              <Button variant="secondary" size="sm" onClick={() => onOpenStockMovement(ingredient)}>
                <ArrowDownToLine className="h-4 w-4" />
                حركة مخزون
              </Button>
              <Button
                variant="ghost"
                size="sm"
                aria-label={`تعديل ${ingredient.name}`}
                onClick={() => onEditIngredient(ingredient)}
              >
                <Pencil className="h-4 w-4" />
                تعديل
              </Button>
            </div>
          </div>
        );
      })}
    </div>
  );
}

export function RecipesTab({
  products,
  recipes,
  hasIngredients,
  onOpenRecipe,
}: {
  products: ProductOption[];
  recipes: ProductIngredient[];
  hasIngredients: boolean;
  onOpenRecipe: (product: ProductOption) => void;
}) {
  if (!products.length) {
    return <EmptyState title="أضف منتجات أولًا" description="بعدها يمكنك ربط كل منتج بمكوناته وكمياتها." />;
  }

  return (
    <div className="divide-y divide-[var(--color-border)]">
      {products.map((product) => {
        const lineCount = recipes.filter((line) => line.product_id === product.id).length;
        return (
          <div key={product.id} className="flex flex-wrap items-center justify-between gap-3 p-4">
            <div>
              <div className="font-bold">{product.name}</div>
              <div className="mt-1 text-xs text-[var(--color-text-secondary)]">
                {lineCount ? `${lineCount} مكونات في الوصفة` : 'بدون وصفة — لا يُخصم مخزون مكونات'}
              </div>
            </div>
            <Button variant="secondary" size="sm" disabled={!hasIngredients} onClick={() => onOpenRecipe(product)}>
              <Pencil className="h-4 w-4" />
              {lineCount ? 'تعديل الوصفة' : 'إضافة وصفة'}
            </Button>
          </div>
        );
      })}
    </div>
  );
}

export function SuppliersTab({
  suppliers,
  onNewSupplier,
  onEditSupplier,
}: {
  suppliers: Supplier[];
  onNewSupplier: () => void;
  onEditSupplier: (supplier: Supplier) => void;
}) {
  return (
    <div className="divide-y divide-[var(--color-border)]">
      <div className="flex justify-end p-3">
        <Button variant="secondary" size="sm" onClick={onNewSupplier}>
          <Plus className="h-4 w-4" />
          مورّد جديد
        </Button>
      </div>
      {!suppliers.length ? (
        <EmptyState title="ما فيه موردون مسجلون" description="أضف الموردين لربطهم بالمكونات وأرقام الشراء." />
      ) : (
        suppliers.map((supplier) => (
          <div key={supplier.id} className="flex flex-wrap items-center justify-between gap-3 p-4">
            <div>
              <div className="font-bold">{supplier.name}</div>
              <div className="mt-1 text-xs text-[var(--color-text-secondary)]">
                {[supplier.contact_name, supplier.phone, supplier.email].filter(Boolean).join(' · ') ||
                  'لا توجد بيانات تواصل'}
              </div>
            </div>
            <Button variant="ghost" size="sm" onClick={() => onEditSupplier(supplier)}>
              <Pencil className="h-4 w-4" />
              تعديل
            </Button>
          </div>
        ))
      )}
    </div>
  );
}

export function MovementsHistoryTab({
  movements,
  ingredients,
}: {
  movements: InventoryMovement[];
  ingredients: Ingredient[];
}) {
  return (
    <div className="divide-y divide-[var(--color-border)]">
      {!movements.length ? (
        <EmptyState title="سجل الحركات فارغ" description="ستظهر هنا عمليات الاستلام والتسوية والاستهلاك والإرجاع." />
      ) : (
        movements.map((movement) => {
          const ingredient = ingredients.find((item) => item.id === movement.ingredient_id);
          const positive = Number(movement.quantity_delta) > 0;
          return (
            <div key={movement.id} className="flex flex-wrap items-center justify-between gap-3 p-4">
              <div className="flex items-center gap-3">
                {positive ? (
                  <ArrowDownToLine className="h-4 w-4 text-[var(--color-success)]" />
                ) : (
                  <ArrowUpFromLine className="h-4 w-4 text-[var(--color-danger)]" />
                )}
                <div>
                  <div className="font-semibold">{ingredient?.name ?? 'مكوّن'}</div>
                  <div className="text-xs text-[var(--color-text-secondary)]">
                    {MOVEMENT_LABELS[movement.movement_type]}
                    {movement.notes ? ` · ${movement.notes}` : ''}
                  </div>
                </div>
              </div>
              <div className="text-end">
                <div
                  className={`font-bold ${positive ? 'text-[var(--color-success)]' : 'text-[var(--color-danger)]'}`}
                  dir="ltr"
                >
                  {positive ? '+' : ''}
                  {quantity(movement.quantity_delta)} {UNIT_LABELS[movement.unit]}
                </div>
                <div className="text-xs text-[var(--color-text-secondary)]">
                  الرصيد بعد الحركة: {quantity(movement.stock_after)} {UNIT_LABELS[movement.unit]}
                </div>
              </div>
              <time className="text-xs text-[var(--color-text-muted)]" dateTime={movement.created_at}>
                {new Intl.DateTimeFormat('ar-BH', {
                  dateStyle: 'short',
                  timeStyle: 'short',
                  timeZone: 'Asia/Bahrain',
                }).format(new Date(movement.created_at))}
              </time>
            </div>
          );
        })
      )}
      <p className="p-3 text-center text-xs text-[var(--color-text-muted)]">
        يعرض آخر 50 حركة. كل عملية بيع أو إلغاء تُسجل تلقائيًا.
      </p>
    </div>
  );
}
