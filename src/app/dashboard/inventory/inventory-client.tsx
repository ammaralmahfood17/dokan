'use client';

import { useState, type FormEvent } from 'react';
import { AlertTriangle, ArrowDownToLine, ArrowUpFromLine, Boxes, Pencil, Plus, Truck } from 'lucide-react';
import { useRouter } from 'next/navigation';
import { toast } from 'sonner';
import { Button } from '@/components/ui/button';
import { EmptyState } from '@/components/ui/empty-state';
import { Modal } from '@/components/ui/modal';
import { createClient } from '@/lib/supabase/client';
import type { Json } from '@/lib/database.types';
import type {
  Ingredient,
  IngredientUnit,
  InventoryMovement,
  InventoryMovementType,
  Product,
  ProductIngredient,
  Supplier,
} from '@/lib/types';

type ProductOption = Pick<Product, 'id' | 'project_id' | 'name' | 'name_en' | 'stock'>;
type Tab = 'ingredients' | 'recipes' | 'suppliers' | 'history';

const UNIT_LABELS: Record<IngredientUnit, string> = {
  g: 'غرام',
  ml: 'مل',
  each: 'حبة',
};

const MOVEMENT_LABELS: Record<InventoryMovementType, string> = {
  receive: 'استلام',
  adjustment: 'تسوية',
  consume: 'استهلاك طلب',
  restore: 'إرجاع إلغاء',
};

function quantity(value: number | string) {
  return Number(value).toLocaleString('en', { maximumFractionDigits: 3 });
}

export function InventoryClient({
  projectId,
  ingredients,
  suppliers,
  products,
  recipes,
  movements,
}: {
  projectId: string;
  ingredients: Ingredient[];
  suppliers: Supplier[];
  products: ProductOption[];
  recipes: ProductIngredient[];
  movements: InventoryMovement[];
}) {
  const router = useRouter();
  const [tab, setTab] = useState<Tab>('ingredients');
  const [ingredientToEdit, setIngredientToEdit] = useState<Ingredient | null>(null);
  const [showIngredientForm, setShowIngredientForm] = useState(false);
  const [supplierToEdit, setSupplierToEdit] = useState<Supplier | null>(null);
  const [showSupplierForm, setShowSupplierForm] = useState(false);
  const [stockTarget, setStockTarget] = useState<Ingredient | null>(null);
  const [recipeProduct, setRecipeProduct] = useState<ProductOption | null>(null);
  const [recipeLines, setRecipeLines] = useState<{ ingredient_id: string; quantity: string }[]>([]);
  const [busy, setBusy] = useState(false);

  const lowStockCount = ingredients.filter(
    (ingredient) => Number(ingredient.quantity_on_hand) <= Number(ingredient.reorder_point)
  ).length;

  function openNewIngredient() {
    setIngredientToEdit(null);
    setShowIngredientForm(true);
  }

  function openRecipe(product: ProductOption) {
    setRecipeProduct(product);
    setRecipeLines(
      recipes
        .filter((line) => line.product_id === product.id)
        .map((line) => ({
          ingredient_id: line.ingredient_id,
          quantity: String(line.quantity_per_product),
        }))
    );
  }

  async function saveIngredient(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    if (busy) return;
    const form = new FormData(event.currentTarget);
    const name = String(form.get('name') ?? '').trim();
    const reorderPoint = Number(form.get('reorder_point') ?? 0);
    const supplierId = String(form.get('supplier_id') ?? '') || null;
    const supplierSku = String(form.get('supplier_sku') ?? '').trim() || null;
    const unit = String(form.get('unit') ?? 'g') as IngredientUnit;

    if (!name || !Number.isFinite(reorderPoint) || reorderPoint < 0) {
      toast.error('أدخل اسمًا ونقطة إعادة طلب صحيحة');
      return;
    }
    if (!ingredientToEdit && !(['g', 'ml', 'each'] as string[]).includes(unit)) {
      toast.error('وحدة القياس غير صالحة');
      return;
    }

    setBusy(true);
    const supabase = createClient();
    const result = ingredientToEdit
      ? await supabase
          .from('ingredients')
          .update({
            name,
            reorder_point: reorderPoint,
            supplier_id: supplierId,
            supplier_sku: supplierSku,
          })
          .eq('id', ingredientToEdit.id)
          .eq('project_id', projectId)
      : await supabase.from('ingredients').insert({
          project_id: projectId,
          name,
          unit,
          reorder_point: reorderPoint,
          supplier_id: supplierId,
          supplier_sku: supplierSku,
        });
    setBusy(false);

    if (result.error) {
      toast.error('تعذر حفظ المكوّن');
      return;
    }
    toast.success(ingredientToEdit ? 'تم تحديث المكوّن' : 'تمت إضافة المكوّن');
    setShowIngredientForm(false);
    setIngredientToEdit(null);
    router.refresh();
  }

  async function saveSupplier(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    if (busy) return;
    const form = new FormData(event.currentTarget);
    const name = String(form.get('name') ?? '').trim();
    const contactName = String(form.get('contact_name') ?? '').trim() || null;
    const email = String(form.get('email') ?? '').trim() || null;
    const phone = String(form.get('phone') ?? '').trim() || null;
    if (!name) {
      toast.error('أدخل اسم المورّد');
      return;
    }

    setBusy(true);
    const supabase = createClient();
    const result = supplierToEdit
      ? await supabase
          .from('suppliers')
          .update({ name, contact_name: contactName, email, phone })
          .eq('id', supplierToEdit.id)
          .eq('project_id', projectId)
      : await supabase
          .from('suppliers')
          .insert({ project_id: projectId, name, contact_name: contactName, email, phone });
    setBusy(false);

    if (result.error) {
      toast.error('تعذر حفظ بيانات المورّد');
      return;
    }
    toast.success(supplierToEdit ? 'تم تحديث بيانات المورّد' : 'تمت إضافة المورّد');
    setShowSupplierForm(false);
    setSupplierToEdit(null);
    router.refresh();
  }

  async function saveMovement(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    if (!stockTarget || busy) return;
    const form = new FormData(event.currentTarget);
    const movementType = String(form.get('movement_type')) as 'receive' | 'adjustment';
    const amount = Number(form.get('quantity'));
    const notes = String(form.get('notes') ?? '').trim();
    if (!Number.isFinite(amount) || amount === 0 || (movementType === 'receive' && amount < 0)) {
      toast.error('أدخل كمية صحيحة؛ الاستلام يجب أن يكون موجبًا');
      return;
    }

    setBusy(true);
    const supabase = createClient();
    const { error } = await supabase.rpc('adjust_ingredient_stock', {
      p_ingredient_id: stockTarget.id,
      p_movement_type: movementType,
      p_quantity: amount,
      p_notes: notes || null,
    });
    setBusy(false);
    if (error) {
      toast.error(
        error.message.includes('INSUFFICIENT_INGREDIENT_STOCK')
          ? 'لا يمكن أن يصبح الرصيد أقل من صفر'
          : 'تعذر تسجيل حركة المخزون'
      );
      return;
    }
    toast.success('تم تحديث رصيد المخزون');
    setStockTarget(null);
    router.refresh();
  }

  async function saveRecipe(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    if (!recipeProduct || busy) return;
    const lines = recipeLines.map((line) => ({
      ingredient_id: line.ingredient_id,
      quantity: Number(line.quantity),
    }));
    if (
      lines.some(
        (line) =>
          !line.ingredient_id || !Number.isFinite(line.quantity) || line.quantity <= 0
      ) ||
      new Set(lines.map((line) => line.ingredient_id)).size !== lines.length
    ) {
      toast.error('أكمل كل المكوّنات والكميات، ولا تكرر المكوّن');
      return;
    }

    setBusy(true);
    const supabase = createClient();
    const { error } = await supabase.rpc('replace_product_recipe', {
      p_product_id: recipeProduct.id,
      p_lines: lines as Json,
    });
    setBusy(false);
    if (error) {
      toast.error('تعذر حفظ الوصفة');
      return;
    }
    toast.success(lines.length ? 'تم حفظ الوصفة' : 'تم إيقاف تتبّع مكونات المنتج');
    setRecipeProduct(null);
    router.refresh();
  }

  return (
    <div className="page">
      <div className="page-header flex flex-wrap items-start justify-between gap-3">
        <div>
          <h1>مخزون المكونات</h1>
          <p>تابع الكميات، الموردين، وصفات المنتجات، وحركات المخزون.</p>
        </div>
        <Button onClick={openNewIngredient}>
          <Plus className="h-4 w-4" />
          مكوّن جديد
        </Button>
      </div>

      <div className="mb-4 grid grid-cols-1 gap-3 sm:grid-cols-3">
        <div className="card card-body flex items-center gap-3">
          <Boxes className="h-5 w-5 text-[var(--color-primary)]" />
          <div>
            <div className="text-xs text-[var(--color-text-secondary)]">المكونات</div>
            <div className="text-lg font-bold">{ingredients.length}</div>
          </div>
        </div>
        <div className="card card-body flex items-center gap-3">
          <AlertTriangle className="h-5 w-5 text-[var(--color-primary)]" />
          <div>
            <div className="text-xs text-[var(--color-text-secondary)]">عند نقطة إعادة الطلب أو أقل</div>
            <div className="text-lg font-bold">{lowStockCount}</div>
          </div>
        </div>
        <div className="card card-body flex items-center gap-3">
          <Truck className="h-5 w-5 text-[var(--color-primary)]" />
          <div>
            <div className="text-xs text-[var(--color-text-secondary)]">الموردون</div>
            <div className="text-lg font-bold">{suppliers.length}</div>
          </div>
        </div>
      </div>

      <section className="card overflow-hidden">
        <div className="flex flex-wrap gap-1 border-b border-[var(--color-border)] p-2">
          {([
            ['ingredients', 'المكونات'],
            ['recipes', 'الوصفات'],
            ['suppliers', 'الموردون'],
            ['history', 'سجل الحركات'],
          ] as [Tab, string][]).map(([value, label]) => (
            <button
              key={value}
              type="button"
              onClick={() => setTab(value)}
              className={`min-h-11 rounded-lg px-3 text-sm font-semibold ${
                tab === value
                  ? 'bg-[var(--color-primary-tint-strong)] text-[var(--color-primary)]'
                  : 'text-[var(--color-text-secondary)] hover:bg-[var(--color-bg)]'
              }`}
              aria-pressed={tab === value}
            >
              {label}
            </button>
          ))}
        </div>

        {tab === 'ingredients' && (
          <div className="divide-y divide-[var(--color-border)]">
            {!ingredients.length ? (
              <EmptyState
                title="ما فيه مكونات مسجلة"
                description="أضف المكونات أولًا، ثم اربطها بوصفات المنتجات لتفعيل الخصم التلقائي."
                action={<Button onClick={openNewIngredient}><Plus className="h-4 w-4" />أضف أول مكوّن</Button>}
              />
            ) : ingredients.map((ingredient) => {
              const low = Number(ingredient.quantity_on_hand) <= Number(ingredient.reorder_point);
              const supplier = suppliers.find((item) => item.id === ingredient.supplier_id);
              return (
                <div key={ingredient.id} className="flex flex-wrap items-center justify-between gap-3 p-4">
                  <div className="min-w-[180px] flex-1">
                    <div className="flex items-center gap-2">
                      <span className="font-bold">{ingredient.name}</span>
                      {low && (
                        <span className="rounded-full bg-[var(--color-danger-tint)] px-2 py-0.5 text-[11.5px] font-semibold text-[var(--color-danger)]">
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
                    <Button variant="secondary" size="sm" onClick={() => setStockTarget(ingredient)}>
                      <ArrowDownToLine className="h-4 w-4" />
                      حركة مخزون
                    </Button>
                    <Button
                      variant="ghost"
                      size="sm"
                      aria-label={`تعديل ${ingredient.name}`}
                      onClick={() => {
                        setIngredientToEdit(ingredient);
                        setShowIngredientForm(true);
                      }}
                    >
                      <Pencil className="h-4 w-4" />
                      تعديل
                    </Button>
                  </div>
                </div>
              );
            })}
          </div>
        )}

        {tab === 'recipes' && (
          <div className="divide-y divide-[var(--color-border)]">
            {!products.length ? (
              <EmptyState title="أضف منتجات أولًا" description="بعدها يمكنك ربط كل منتج بمكوناته وكمياتها." />
            ) : products.map((product) => {
              const lineCount = recipes.filter((line) => line.product_id === product.id).length;
              return (
                <div key={product.id} className="flex flex-wrap items-center justify-between gap-3 p-4">
                  <div>
                    <div className="font-bold">{product.name}</div>
                    <div className="mt-1 text-xs text-[var(--color-text-secondary)]">
                      {lineCount ? `${lineCount} مكونات في الوصفة` : 'بدون وصفة — لا يُخصم مخزون مكونات'}
                    </div>
                  </div>
                  <Button
                    variant="secondary"
                    size="sm"
                    disabled={!ingredients.length}
                    onClick={() => openRecipe(product)}
                  >
                    <Pencil className="h-4 w-4" />
                    {lineCount ? 'تعديل الوصفة' : 'إضافة وصفة'}
                  </Button>
                </div>
              );
            })}
          </div>
        )}

        {tab === 'suppliers' && (
          <div className="divide-y divide-[var(--color-border)]">
            <div className="flex justify-end p-3">
              <Button
                variant="secondary"
                size="sm"
                onClick={() => {
                  setSupplierToEdit(null);
                  setShowSupplierForm(true);
                }}
              >
                <Plus className="h-4 w-4" />
                مورّد جديد
              </Button>
            </div>
            {!suppliers.length ? (
              <EmptyState title="ما فيه موردون مسجلون" description="أضف الموردين لربطهم بالمكونات وأرقام الشراء." />
            ) : suppliers.map((supplier) => (
              <div key={supplier.id} className="flex flex-wrap items-center justify-between gap-3 p-4">
                <div>
                  <div className="font-bold">{supplier.name}</div>
                  <div className="mt-1 text-xs text-[var(--color-text-secondary)]">
                    {[supplier.contact_name, supplier.phone, supplier.email].filter(Boolean).join(' · ') || 'لا توجد بيانات تواصل'}
                  </div>
                </div>
                <Button
                  variant="ghost"
                  size="sm"
                  onClick={() => {
                    setSupplierToEdit(supplier);
                    setShowSupplierForm(true);
                  }}
                >
                  <Pencil className="h-4 w-4" />
                  تعديل
                </Button>
              </div>
            ))}
          </div>
        )}

        {tab === 'history' && (
          <div className="divide-y divide-[var(--color-border)]">
            {!movements.length ? (
              <EmptyState title="سجل الحركات فارغ" description="ستظهر هنا عمليات الاستلام والتسوية والاستهلاك والإرجاع." />
            ) : movements.map((movement) => {
              const ingredient = ingredients.find((item) => item.id === movement.ingredient_id);
              const positive = Number(movement.quantity_delta) > 0;
              return (
                <div key={movement.id} className="flex flex-wrap items-center justify-between gap-3 p-4">
                  <div className="flex items-center gap-3">
                    {positive
                      ? <ArrowDownToLine className="h-4 w-4 text-[var(--color-success)]" />
                      : <ArrowUpFromLine className="h-4 w-4 text-[var(--color-danger)]" />}
                    <div>
                      <div className="font-semibold">{ingredient?.name ?? 'مكوّن'}</div>
                      <div className="text-xs text-[var(--color-text-secondary)]">
                        {MOVEMENT_LABELS[movement.movement_type]}{movement.notes ? ` · ${movement.notes}` : ''}
                      </div>
                    </div>
                  </div>
                  <div className="text-end">
                    <div className={`font-bold ${positive ? 'text-[var(--color-success)]' : 'text-[var(--color-danger)]'}`} dir="ltr">
                      {positive ? '+' : ''}{quantity(movement.quantity_delta)} {UNIT_LABELS[movement.unit]}
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
            })}
            <p className="p-3 text-center text-xs text-[var(--color-text-muted)]">
              يعرض آخر 50 حركة. كل عملية بيع أو إلغاء تُسجل تلقائيًا.
            </p>
          </div>
        )}
      </section>

      {showIngredientForm && (
        <Modal
          title={ingredientToEdit ? 'تعديل المكوّن' : 'مكوّن جديد'}
          onClose={() => { setShowIngredientForm(false); setIngredientToEdit(null); }}
        >
          <form onSubmit={saveIngredient} className="space-y-3">
            <label className="block">
              <span className="label">اسم المكوّن *</span>
              <input className="input" name="name" required maxLength={120} defaultValue={ingredientToEdit?.name ?? ''} />
            </label>
            {!ingredientToEdit && (
              <label className="block">
                <span className="label">وحدة القياس *</span>
                <select className="select" name="unit" defaultValue="g">
                  <option value="g">غرام (g)</option>
                  <option value="ml">ملليلتر (ml)</option>
                  <option value="each">حبة (each)</option>
                </select>
              </label>
            )}
            <label className="block">
              <span className="label">نقطة إعادة الطلب ({UNIT_LABELS[ingredientToEdit?.unit ?? 'g']})</span>
              <input
                className="input"
                name="reorder_point"
                type="number"
                min="0"
                step="0.001"
                max="1000000000"
                maxLength={16}
                inputMode="decimal"
                defaultValue={ingredientToEdit?.reorder_point ?? 0}
              />
            </label>
            <label className="block">
              <span className="label">المورّد</span>
              <select className="select" name="supplier_id" defaultValue={ingredientToEdit?.supplier_id ?? ''}>
                <option value="">بدون مورّد</option>
                {suppliers.map((supplier) => <option key={supplier.id} value={supplier.id}>{supplier.name}</option>)}
              </select>
            </label>
            <label className="block">
              <span className="label">رمز SKU لدى المورّد</span>
              <input className="input" name="supplier_sku" maxLength={100} defaultValue={ingredientToEdit?.supplier_sku ?? ''} />
            </label>
            <div className="flex gap-2 pt-2">
              <Button type="submit" isLoading={busy} block>حفظ</Button>
              <Button type="button" variant="secondary" onClick={() => { setShowIngredientForm(false); setIngredientToEdit(null); }}>إلغاء</Button>
            </div>
          </form>
        </Modal>
      )}

      {showSupplierForm && (
        <Modal
          title={supplierToEdit ? 'تعديل بيانات المورّد' : 'مورّد جديد'}
          onClose={() => { setShowSupplierForm(false); setSupplierToEdit(null); }}
        >
          <form onSubmit={saveSupplier} className="space-y-3">
            <label className="block">
              <span className="label">اسم المورّد *</span>
              <input className="input" name="name" required maxLength={120} defaultValue={supplierToEdit?.name ?? ''} />
            </label>
            <label className="block">
              <span className="label">اسم جهة التواصل</span>
              <input className="input" name="contact_name" maxLength={120} defaultValue={supplierToEdit?.contact_name ?? ''} />
            </label>
            <label className="block">
              <span className="label">البريد الإلكتروني</span>
              <input className="input" name="email" type="email" maxLength={254} defaultValue={supplierToEdit?.email ?? ''} />
            </label>
            <label className="block">
              <span className="label">الهاتف</span>
              <input className="input" name="phone" type="tel" maxLength={40} defaultValue={supplierToEdit?.phone ?? ''} />
            </label>
            <div className="flex gap-2 pt-2">
              <Button type="submit" isLoading={busy} block>حفظ</Button>
              <Button type="button" variant="secondary" onClick={() => { setShowSupplierForm(false); setSupplierToEdit(null); }}>إلغاء</Button>
            </div>
          </form>
        </Modal>
      )}

      {stockTarget && (
        <Modal title={`حركة مخزون — ${stockTarget.name}`} onClose={() => setStockTarget(null)}>
          <form onSubmit={saveMovement} className="space-y-3">
            <p className="text-xs text-[var(--color-text-secondary)]">
              الرصيد الحالي: {quantity(stockTarget.quantity_on_hand)} {UNIT_LABELS[stockTarget.unit]}
            </p>
            <label className="block">
              <span className="label">نوع الحركة</span>
              <select className="select" name="movement_type" defaultValue="receive">
                <option value="receive">استلام كمية</option>
                <option value="adjustment">تسوية رصيد (+ أو -)</option>
              </select>
            </label>
            <label className="block">
              <span className="label">الكمية ({UNIT_LABELS[stockTarget.unit]}) *</span>
              <input className="input" name="quantity" type="number" step="0.001" max="1000000000" maxLength={16} inputMode="decimal" required />
            </label>
            <label className="block">
              <span className="label">ملاحظة</span>
              <input className="input" name="notes" maxLength={500} />
            </label>
            <div className="flex gap-2 pt-2">
              <Button type="submit" isLoading={busy} block>تسجيل الحركة</Button>
              <Button type="button" variant="secondary" onClick={() => setStockTarget(null)}>إلغاء</Button>
            </div>
          </form>
        </Modal>
      )}

      {recipeProduct && (
        <Modal title={`وصفة: ${recipeProduct.name}`} onClose={() => setRecipeProduct(null)}>
          <form onSubmit={saveRecipe} className="space-y-3">
            <p className="text-xs text-[var(--color-text-secondary)]">
              الكميات لكل منتج واحد. تستخدم كل مادة وحدة الأساس المسجلة لها.
            </p>
            {recipeLines.map((line, index) => {
              const ingredient = ingredients.find((item) => item.id === line.ingredient_id);
              return (
                <div key={`${recipeProduct.id}-${index}`} className="grid grid-cols-[minmax(0,1fr)_7rem_2.75rem] items-end gap-2">
                  <label className="block min-w-0">
                    <span className="label">المكوّن</span>
                    <select
                      className="select"
                      value={line.ingredient_id}
                      onChange={(event) => setRecipeLines((prev) => prev.map((item, i) => i === index ? { ...item, ingredient_id: event.target.value } : item))}
                    >
                      <option value="">اختر مكوّنًا</option>
                      {ingredients.map((item) => (
                        <option key={item.id} value={item.id} disabled={prevRecipeUses(recipeLines, index, item.id)}>
                          {item.name} ({UNIT_LABELS[item.unit]})
                        </option>
                      ))}
                    </select>
                  </label>
                  <label className="block">
                    <span className="label">الكمية {ingredient ? `(${UNIT_LABELS[ingredient.unit]})` : ''}</span>
                    <input
                      className="input"
                      type="number"
                      min="0.001"
                      max="1000000000"
                      step="0.001"
                      maxLength={16}
                      inputMode="decimal"
                      value={line.quantity}
                      onChange={(event) => setRecipeLines((prev) => prev.map((item, i) => i === index ? { ...item, quantity: event.target.value } : item))}
                    />
                  </label>
                  <button
                    type="button"
                    className="btn btn-secondary h-11"
                    aria-label={`حذف السطر ${index + 1}`}
                    onClick={() => setRecipeLines((prev) => prev.filter((_, i) => i !== index))}
                  >
                    ×
                  </button>
                </div>
              );
            })}
            <Button
              type="button"
              variant="secondary"
              block
              disabled={recipeLines.length >= Math.min(50, ingredients.length)}
              onClick={() => setRecipeLines((prev) => [...prev, { ingredient_id: '', quantity: '' }])}
            >
              <Plus className="h-4 w-4" />
              إضافة مكوّن للوصفة
            </Button>
            <p className="text-[11.5px] text-[var(--color-text-muted)]">
              حذف جميع الأسطر يحوّل المنتج إلى غير متتبّع، ولا يغيّر رصيد المكونات.
            </p>
            <div className="flex gap-2 pt-2">
              <Button type="submit" isLoading={busy} block>حفظ الوصفة</Button>
              <Button type="button" variant="secondary" onClick={() => setRecipeProduct(null)}>إلغاء</Button>
            </div>
          </form>
        </Modal>
      )}
    </div>
  );
}

function prevRecipeUses(
  lines: { ingredient_id: string; quantity: string }[],
  currentIndex: number,
  ingredientId: string
) {
  return lines.some((line, index) => index !== currentIndex && line.ingredient_id === ingredientId);
}
