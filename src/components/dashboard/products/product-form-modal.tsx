'use client';

// FIX-C-001: ProductFormModal — extracted VERBATIM from products-client.tsx.
// Create/edit product: name (ar/en), description, price, category + quick-add,
// image upload, addons, availability toggle. All form state lives here.
import { useCallback, useRef, useState, type FormEvent } from 'react';
import { Plus, Trash2, X } from 'lucide-react';
import { createClient } from '@/lib/supabase/client';
import { currencyDecimals } from '@/lib/utils';
import { Button } from '@/components/ui/button';
import { Modal } from '@/components/ui/modal';
import { Toggle } from '@/components/ui/toggle';
import type { Category, Product, ProductOptionGroup, ProductWithOptions } from '@/lib/types';
import { toast } from 'sonner';
import { validateProduct, revalidateMenuCache, type FieldErrors } from '@/lib/products-utils';
import { ImageUploader } from '@/components/dashboard/products/image-uploader';
import { saveProduct, validateStockInput } from '@/lib/product-form';

/** Re-exported for existing importers; the type itself lives in lib/types. */
export type { ProductWithOptions };

/** Temporary option variety in the product form — id is set for persisted rows. */
type FormChoice = { key: string; id?: string; name: string; price: string };

/**
 * Temporary option group in the product form.
 *
 * `required` and `single` are the merchant-facing switches the owner asked for
 * («أحدد لكل خيار: نوع واحد أو متعدد + إلزامي أو اختياري»); they map to
 * min_select / max_select on save. A multi group is written with a wide max —
 * the server clamps it to however many varieties are actually available, so a
 * sold-out variety can never make the group impossible to satisfy.
 */
type FormGroup = {
  key: string;
  id?: string;
  name: string;
  required: boolean;
  single: boolean;
  choices: FormChoice[];
};

export function ProductFormModal({
  projectId,
  currency,
  categories,
  products,
  editing,
  onClose,
  onSaved,
  onRequestDelete,
}: {
  projectId: string;
  currency: string;
  categories: Category[];
  products: ProductWithOptions[];
  /** المنتج الجاري تعديله — null = إنشاء جديد */
  editing: ProductWithOptions | null;
  onClose: () => void;
  /** (product, editingId|null) — يحدّث القائمة في الـ parent */
  onSaved: (product: ProductWithOptions, editingId: string | null) => void;
  /** طلب فتح تأكيد الحذف (زر الحذف داخل نموذج التعديل) */
  onRequestDelete: (p: ProductWithOptions) => void;
}) {
  const [loading, setLoading] = useState(false);
  const [name, setName] = useState(editing?.name ?? '');
  const [nameEn, setNameEn] = useState(editing?.name_en ?? '');
  const [description, setDescription] = useState(editing?.description ?? '');
  const [price, setPrice] = useState(editing ? String(editing.price) : '');
  const [categoryId, setCategoryId] = useState(editing?.category_id ?? categories[0]?.id ?? '');
  const [isAvailable, setIsAvailable] = useState(editing?.is_available ?? true);
  // Stock (0018). '' = untracked/unlimited — the honest default for every
  // product that existed before the feature and for merchants who don't count
  // portions; is_available above remains their manual switch.
  const [stock, setStock] = useState(editing?.stock != null ? String(editing.stock) : '');
  const [imageUrl, setImageUrl] = useState(editing?.image_url ?? '');
  const [formGroups, setFormGroups] = useState<FormGroup[]>(
    (editing?.option_groups || [])
      .slice()
      .sort((a, b) => a.sort_order - b.sort_order)
      .map((g) => ({
        key: `init_${g.id}`,
        id: g.id,
        name: g.name,
        required: g.min_select >= 1,
        single: g.max_select <= 1,
        choices: (g.option_choices ?? [])
          .slice()
          .sort((a, b) => a.sort_order - b.sort_order)
          .map((c) => ({
            key: `init_${c.id}`,
            id: c.id,
            name: c.name,
            price: String(c.price),
          })),
      }))
  );

  // Validation errors
  const [fieldErrors, setFieldErrors] = useState<FieldErrors>({});

  // Inline category quick-add
  const [showQuickCat, setShowQuickCat] = useState(false);
  const [quickCatName, setQuickCatName] = useState('');

  const formKeyRef = useRef(0);
  const nextFormKey = useCallback((prefix: string) => {
    formKeyRef.current += 1;
    return `${prefix}_${formKeyRef.current}`;
  }, []);

  function addFormGroup() {
    setFormGroups((prev) => [
      ...prev,
      {
        key: nextFormKey('group'),
        name: '',
        required: true,
        single: true,
        // Start with one empty variety so the merchant sees the shape immediately.
        choices: [{ key: nextFormKey('choice'), name: '', price: '0' }],
      },
    ]);
  }

  function updateFormGroup(key: string, patch: Partial<Pick<FormGroup, 'name' | 'required' | 'single'>>) {
    setFormGroups((prev) => prev.map((g) => (g.key === key ? { ...g, ...patch } : g)));
  }

  function removeFormGroup(key: string) {
    setFormGroups((prev) => prev.filter((g) => g.key !== key));
  }

  function addFormChoice(groupKey: string) {
    setFormGroups((prev) =>
      prev.map((g) =>
        g.key === groupKey
          ? { ...g, choices: [...g.choices, { key: nextFormKey('choice'), name: '', price: '0' }] }
          : g
      )
    );
  }

  function updateFormChoice(groupKey: string, choiceKey: string, field: 'name' | 'price', value: string) {
    setFormGroups((prev) =>
      prev.map((g) =>
        g.key === groupKey
          ? { ...g, choices: g.choices.map((c) => (c.key === choiceKey ? { ...c, [field]: value } : c)) }
          : g
      )
    );
  }

  function removeFormChoice(groupKey: string, choiceKey: string) {
    setFormGroups((prev) =>
      prev.map((g) =>
        g.key === groupKey ? { ...g, choices: g.choices.filter((c) => c.key !== choiceKey) } : g
      )
    );
  }

  // ----- Inline Quick Category -----
  async function addQuickCategory() {
    const name = quickCatName.trim();
    if (!name) return;
    setLoading(true);
    try {
      const supabase = createClient();
      const { data, error } = await supabase
        .from('categories')
        .insert({ project_id: projectId, name, sort_order: categories.length })
        .select('*')
        .single();
      if (error || !data) {
        toast.error('فشل إنشاء التصنيف');
        return;
      }
      const cat = data as Category;
      setCategoryId(cat.id);
      setQuickCatName('');
      setShowQuickCat(false);
      toast.success(`تم إنشاء «${cat.name}»`);
    } finally {
      setLoading(false);
    }
  }

  // ----- Save Product -----
  // ONE call: lib/product-form validates and sends the product + its whole
  // option tree to upsert_product_with_options, which commits atomically.
  async function handleSaveProduct(e: FormEvent) {
    e.preventDefault();
    const errors = validateProduct(name, price);
    setFieldErrors(errors);
    if (Object.keys(errors).length > 0) return;

    const stockCheck = validateStockInput(stock);
    if (!stockCheck.ok) {
      toast.error(stockCheck.message);
      return;
    }

    setLoading(true);
    const supabase = createClient();
    try {
      const result = await saveProduct(supabase, {
        projectId,
        productId: editing?.id ?? null,
        values: { name, nameEn, description, price, categoryId, isAvailable, imageUrl, stock },
        groups: formGroups,
        currency,
      });

      if (!result.ok) {
        toast.error(result.message);
        return;
      }

      onSaved(result.product, editing?.id ?? null);
      toast.success(editing ? 'تم تحديث المنتج' : 'تمت إضافة المنتج');
      onClose();
      revalidateMenuCache(projectId);
    } catch {
      console.error('[Products] saveProduct unexpected error');
      toast.error('خطأ غير متوقع — حاول مجددًا');
    } finally {
      setLoading(false);
    }
  }

  return (
    <Modal title={editing ? 'تعديل منتج' : 'منتج جديد'} onClose={onClose}>
      <form onSubmit={handleSaveProduct} className="space-y-5">
        {/* NAME + NAME EN (2-col) */}
        <div className="grid gap-3 sm:grid-cols-2">
          <div className="field">
            <label className="label" htmlFor="product-name">الاسم بالعربي</label>
            <input
              id="product-name"
              className={`input ${fieldErrors.name ? 'input-error' : ''}`}
              aria-invalid={!!fieldErrors.name}
              aria-describedby={fieldErrors.name ? 'product-name-error' : undefined}
              required
              maxLength={100}
              value={name}
              onChange={(e) => {
                setName(e.target.value);
                if (fieldErrors.name) setFieldErrors((prev) => ({ ...prev, name: undefined }));
              }}
              onBlur={() => {
                const err = validateProduct(name, price);
                if (err.name) setFieldErrors((prev) => ({ ...prev, name: err.name }));
              }}
              placeholder="مثال: قهوة عربية"
            />
            {fieldErrors.name && <p id="product-name-error" className="error-text" role="alert">{fieldErrors.name}</p>}
          </div>
          <div className="field">
            <label htmlFor="product-name-en" className="label">بالإنجليزي</label>
            <input
              id="product-name-en"
              className="input"
              dir="ltr"
              maxLength={100}
              value={nameEn}
              onChange={(e) => setNameEn(e.target.value)}
              placeholder="Arabic Coffee"
            />
          </div>
        </div>

        {/* DESCRIPTION */}
        <div className="field">
          <label htmlFor="product-description" className="label">الوصف</label>
          <textarea
            id="product-description"
            className="textarea"
            rows={3}
            maxLength={500}
            value={description}
            onChange={(e) => setDescription(e.target.value)}
            placeholder="وصف مختصر للمنتج يظهر للعملاء في القائمة"
          />
        </div>

        {/* PRICE + CATEGORY (2-col) */}
        <div className="grid gap-3 sm:grid-cols-2">
          <div className="field">
            <label className="label" htmlFor="product-price">
              السعر <span className="text-[var(--color-text-muted)]">({currency})</span>
            </label>
            <div className="relative">
              <input
                id="product-price"
                className={`input ${fieldErrors.price ? 'input-error' : ''}`}
                aria-invalid={!!fieldErrors.price}
                aria-describedby={fieldErrors.price ? 'product-price-error' : undefined}
                type="number"
                inputMode="decimal"
                step="0.001"
                min="0"
                required
                dir="ltr"
                value={price}
                onChange={(e) => {
                  setPrice(e.target.value);
                  if (fieldErrors.price) setFieldErrors((prev) => ({ ...prev, price: undefined }));
                }}
                onBlur={() => {
                  const err = validateProduct(name, price);
                  if (err.price) setFieldErrors((prev) => ({ ...prev, price: err.price }));
                }}
                placeholder={`0.${'0'.repeat(currencyDecimals(currency))}`}
              />
            </div>
            {fieldErrors.price && <p id="product-price-error" className="error-text" role="alert">{fieldErrors.price}</p>}
          </div>

          {/* Category select with inline quick-add */}
          <div className="field">
            <label htmlFor="product-category" className="label">التصنيف</label>
            <div className="flex gap-1">
              <select
                id="product-category"
                className="select flex-1"
                value={categoryId}
                onChange={(e) => setCategoryId(e.target.value)}
              >
                <option value="">بدون تصنيف</option>
                {categories.map((c) => (
                  <option key={c.id} value={c.id}>
                    {c.name}
                  </option>
                ))}
              </select>
              <button
                type="button"
                onClick={() => { setShowQuickCat(true); setQuickCatName(''); }}
                className="btn btn-secondary btn-sm min-h-[44px] min-w-[44px] flex items-center justify-center"
                title="تصنيف جديد"
              >
                <Plus className="h-4 w-4" />
              </button>
            </div>
            {/* Inline quick-add category */}
            {showQuickCat && (
              <div className="mt-2 flex items-center gap-2 rounded-[var(--radius-md)] border border-[var(--color-primary)] bg-[var(--color-primary-tint)] p-2">
                <input
                  className="input flex-1 border-0 bg-white text-sm"
                  placeholder="اسم التصنيف الجديد"
                  maxLength={50}
                  value={quickCatName}
                  onChange={(e) => setQuickCatName(e.target.value)}
                  onKeyDown={(e) => { if (e.key === 'Enter') { e.preventDefault(); addQuickCategory(); } }}
                  autoFocus
                />
                <button
                  type="button"
                  onClick={addQuickCategory}
                  disabled={loading || !quickCatName.trim()}
                  className="btn btn-primary btn-sm whitespace-nowrap"
                >
                  {loading ? '…' : 'إضافة'}
                </button>
                <button
                  type="button"
                  onClick={() => setShowQuickCat(false)}
                  aria-label="إلغاء إضافة تصنيف"
                  className="btn btn-ghost btn-sm"
                >
                  <X className="h-4 w-4" />
                </button>
              </div>
            )}
          </div>
        </div>

        {/* ======== IMAGE UPLOAD — extracted component ======== */}
        {/* AR-2: اسم المنتج يُمرَّر للـ alt الوصفي */}
        <ImageUploader
          projectId={projectId}
          imageUrl={imageUrl}
          onImageUrlChange={setImageUrl}
          productName={name.trim() || undefined}
        />

        {/* ======== OPTIONS — «خيارات» وكل خيار له «أنواع» بسعر لكل نوع ======== */}
        <fieldset className="rounded-[var(--radius-md)] border border-[var(--color-border)] bg-[var(--color-bg)] p-3">
          <div className="mb-1 flex items-center justify-between">
            <legend className="label mb-0">
              الخيارات <span className="text-[var(--color-text-muted)]">(اختياري)</span>
            </legend>
            <button
              type="button"
              onClick={addFormGroup}
              className="btn btn-ghost btn-sm gap-1"
            >
              <Plus className="h-3.5 w-3.5" />
              خيار جديد
            </button>
          </div>
          <p className="mb-3 text-[11.5px] leading-relaxed text-[var(--color-text-muted)]">
            مثال: خيار «الحجم» وأنواعه صغير / وسط / كبير — ولكل نوع سعره.
          </p>

          {formGroups.length === 0 && (
            <p className="rounded-[var(--radius-md)] bg-[var(--color-surface)] px-3 py-4 text-center text-xs text-[var(--color-text-muted)]">
              ما فيه خيارات.
            </p>
          )}

          {formGroups.map((group) => (
            <div
              key={group.key}
              className="mb-3 rounded-[var(--radius-md)] border border-[var(--color-border)] bg-[var(--color-surface)] p-3"
            >
              <div className="mb-2 flex items-center gap-2">
                <input
                  className="input flex-1 text-sm"
                  placeholder="اسم الخيار (مثال: الحجم)"
                  maxLength={50}
                  value={group.name}
                  onChange={(e) => updateFormGroup(group.key, { name: e.target.value })}
                  aria-label="اسم الخيار"
                />
                <button
                  type="button"
                  onClick={() => removeFormGroup(group.key)}
                  aria-label={`حذف الخيار ${group.name || ''}`.trim()}
                  className="btn btn-ghost btn-sm shrink-0 text-[var(--color-danger)]"
                >
                  <Trash2 className="h-3.5 w-3.5" />
                </button>
              </div>

              <div className="mb-3 flex flex-wrap gap-x-4 gap-y-1.5 text-[12.5px]">
                <label className="flex min-h-[32px] cursor-pointer items-center gap-1.5">
                  <input
                    type="checkbox"
                    className="h-4 w-4"
                    checked={group.single}
                    onChange={(e) => updateFormGroup(group.key, { single: e.target.checked })}
                  />
                  يختار نوعاً واحداً
                </label>
                <label className="flex min-h-[32px] cursor-pointer items-center gap-1.5">
                  <input
                    type="checkbox"
                    className="h-4 w-4"
                    checked={group.required}
                    onChange={(e) => updateFormGroup(group.key, { required: e.target.checked })}
                  />
                  إلزامي
                </label>
              </div>

              <p className="mb-1.5 text-[11.5px] font-semibold text-[var(--color-text-secondary)]">الأنواع</p>
              {group.choices.map((choice) => (
                <div key={choice.key} className="mb-2 flex items-center gap-2">
                  <input
                    className="input flex-1 text-sm"
                    placeholder="اسم النوع (مثال: كبير)"
                    maxLength={50}
                    value={choice.name}
                    onChange={(e) => updateFormChoice(group.key, choice.key, 'name', e.target.value)}
                    aria-label="اسم النوع"
                  />
                  <div className="relative w-24 shrink-0">
                    <input
                      className="input w-full text-sm"
                      type="number"
                      step="0.001"
                      min="0"
                      dir="ltr"
                      inputMode="decimal"
                      placeholder={`0.${'0'.repeat(currencyDecimals(currency))}`}
                      value={choice.price}
                      onChange={(e) => updateFormChoice(group.key, choice.key, 'price', e.target.value)}
                      aria-label="سعر النوع"
                    />
                  </div>
                  <button
                    type="button"
                    onClick={() => removeFormChoice(group.key, choice.key)}
                    aria-label={`حذف النوع ${choice.name || ''}`.trim()}
                    className="btn btn-ghost btn-sm shrink-0 text-[var(--color-danger)]"
                  >
                    <Trash2 className="h-3.5 w-3.5" />
                  </button>
                </div>
              ))}
              <button
                type="button"
                onClick={() => addFormChoice(group.key)}
                className="btn btn-ghost btn-sm gap-1"
              >
                <Plus className="h-3.5 w-3.5" />
                نوع
              </button>
            </div>
          ))}
        </fieldset>

        {/* ======== AVAILABLE TOGGLE ======== */}
        <div className="flex items-center gap-3">
          <Toggle
            id="product-available"
            checked={isAvailable}
            onChange={setIsAvailable}
            aria-label="المنتج متاح للطلب"
          />
          <label htmlFor="product-available" className="cursor-pointer text-sm font-semibold">
            المنتج متاح للطلب
          </label>
        </div>

        {/* ======== STOCK (0018) ======== */}
        <div className="field">
          <label className="label" htmlFor="product-stock">
            عدد الحصص <span className="text-[var(--color-text-muted)]">(اختياري)</span>
          </label>
          <input
            id="product-stock"
            className="input"
            type="number"
            inputMode="numeric"
            min="0"
            step="1"
            maxLength={4}
            dir="ltr"
            value={stock}
            onChange={(e) => setStock(e.target.value)}
            placeholder="اتركه فارغاً = بدون حد"
          />
          <p className="mt-1 text-xs text-[var(--color-text-muted)]">
            فارغ = بلا حد. عند وصول العدد إلى صفر يظهر الصنف «غير متوفر» تلقائياً، ويُرجَع
            العدد عند إلغاء الطلب. المتاح للطلب أعلاه يبقى مفتاحك اليدوي.
          </p>
        </div>

        {/* ======== BUTTONS ======== */}
        <div className="flex gap-2">
          <Button type="submit" block disabled={loading}>
            {loading
              ? 'جاري الحفظ…'
              : editing
              ? 'حفظ التغييرات'
              : 'إضافة المنتج'}
          </Button>
          {editing && (
            <Button
              type="button"
              variant="danger"
              onClick={() => onRequestDelete(editing)}
            >
              <Trash2 className="h-4 w-4" />
              حذف
            </Button>
          )}
          <Button type="button" variant="secondary" onClick={onClose}>
            إلغاء
          </Button>
        </div>
      </form>
    </Modal>
  );
}
