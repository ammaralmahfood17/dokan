'use client';

// FIX-C-001: ProductFormModal — extracted VERBATIM from products-client.tsx.
// Create/edit product: name (ar/en), description, price, category + quick-add,
// image upload, addons, availability toggle. All form state lives here.
import { useCallback, useRef, useState, type FormEvent } from 'react';
import { Plus, Trash2, X } from 'lucide-react';
import { createClient } from '@/lib/supabase/client';
import { formatMoney, money, currencyDecimals } from '@/lib/utils';
import { Button } from '@/components/ui/button';
import { Modal } from '@/components/ui/modal';
import { Toggle } from '@/components/ui/toggle';
import type { Category, Product, ProductAddon } from '@/lib/types';
import type { Database } from '@/lib/database.types';
import { toast } from 'sonner';
import { validateProduct, type FieldErrors } from '@/lib/products-utils';
import { ImageUploader } from '@/components/dashboard/products/image-uploader';

export type ProductWithAddons = Product & { product_addons: ProductAddon[] };

/** Temporary addon line in the product form — id is set for existing (persisted) addons */
type FormAddon = { key: string; id?: string; name: string; price: string };

function revalidateMenuCache(projectId: string) {
  void fetch('/api/revalidate-menu', {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ projectId }),
  }).catch(() => {});
}

/** '' → null (untracked/unlimited). Otherwise the whole, non-negative count. */
function parseStockInput(raw: string): number | null {
  const t = raw.trim();
  if (!t) return null;
  const n = Number(t);
  if (!Number.isFinite(n)) return null;
  return Math.max(0, Math.trunc(n));
}

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
  products: ProductWithAddons[];
  /** المنتج الجاري تعديله — null = إنشاء جديد */
  editing: ProductWithAddons | null;
  onClose: () => void;
  /** (product, editingId|null) — يحدّث القائمة في الـ parent */
  onSaved: (product: ProductWithAddons, editingId: string | null) => void;
  /** طلب فتح تأكيد الحذف (زر الحذف داخل نموذج التعديل) */
  onRequestDelete: (p: ProductWithAddons) => void;
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
  const [formAddons, setFormAddons] = useState<FormAddon[]>(
    (editing?.product_addons || []).map((a) => ({
      key: `init_${a.id}`,
      id: a.id,
      name: a.name,
      price: String(a.price),
    }))
  );

  // Validation errors
  const [fieldErrors, setFieldErrors] = useState<FieldErrors>({});

  // Inline category quick-add
  const [showQuickCat, setShowQuickCat] = useState(false);
  const [quickCatName, setQuickCatName] = useState('');

  const addonKeyRef = useRef(0);
  const nextAddonKey = useCallback(() => {
    addonKeyRef.current += 1;
    return `addon_${addonKeyRef.current}`;
  }, []);

  function addFormAddon() {
    setFormAddons((prev) => [
      ...prev,
      { key: nextAddonKey(), name: '', price: '0.500' },
    ]);
  }

  function updateFormAddon(key: string, field: 'name' | 'price', value: string) {
    setFormAddons((prev) =>
      prev.map((a) => (a.key === key ? { ...a, [field]: value } : a))
    );
  }

  function removeFormAddon(key: string) {
    setFormAddons((prev) => prev.filter((a) => a.key !== key));
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
  async function saveProduct(e: FormEvent) {
    e.preventDefault();
    const errors = validateProduct(name, price);
    setFieldErrors(errors);
    if (Object.keys(errors).length > 0) return;

    // Validate addon prices FIRST — abort on any invalid one (no silent drops)
    for (const a of formAddons) {
      if (!a.name.trim()) continue;
      const addonPrice = Number(a.price);
      if (!Number.isFinite(addonPrice) || addonPrice < 0) {
        toast.error(`سعر الإضافة «${a.name.trim()}» غير صالح`);
        return;
      }
    }

    const parsedPrice = Number(price);

    // Stock must be a whole, non-negative count — or empty for untracked.
    // Rejecting here keeps the DB check constraint from surfacing as a
    // generic «فشل الإضافة».
    if (stock.trim()) {
      const n = Number(stock);
      if (!Number.isInteger(n) || n < 0) {
        toast.error('عدد الحصص يجب أن يكون رقماً صحيحاً غير سالب');
        return;
      }
    }

    setLoading(true);
    const supabase = createClient();
    try {
      const updatePayload: Database['public']['Tables']['products']['Update'] = {
        name: name.trim(),
        name_en: nameEn.trim() || null,
        description: description.trim() || null,
        price: money(parsedPrice, currencyDecimals(currency)),
        category_id: categoryId || null,
        is_available: isAvailable,
        image_url: imageUrl.trim() || null,
        stock: parseStockInput(stock),
      };

      const processedAddons: { id?: string; name: string; price: number }[] =
        formAddons
          .filter((a) => a.name.trim().length > 0)
          .map((a) => ({
            id: a.id,
            name: a.name.trim(),
            price: money(Number(a.price), currencyDecimals(currency)),
          }));

      if (editing) {
        const { data, error } = await supabase
          .from('products')
          .update(updatePayload)
          .eq('id', editing.id)
          .eq('project_id', projectId)
          .select('*, product_addons(*)')
          .single();

        if (error || !data) {
          toast.error('فشل التحديث');
          return;
        }

        // Verify the product still belongs to this project before touching addons
        const { data: owned } = await supabase
          .from('products')
          .select('id')
          .eq('id', editing.id)
          .eq('project_id', projectId)
          .maybeSingle();
        if (!owned) {
          toast.error('لا يمكن تعديل هذا المنتج');
          return;
        }

        // Upsert addons: update in place (keeps id + is_available), insert new, delete removed
        const currentAddons = editing.product_addons || [];
        const keptIds = new Set(
          processedAddons.filter((a): a is { id: string; name: string; price: number } => !!a.id).map((a) => a.id)
        );
        const removedAddons = currentAddons.filter((a) => !keptIds.has(a.id));

        if (removedAddons.length > 0) {
          const { error: deleteAddonErr } = await supabase
            .from('product_addons')
            .delete()
            .eq('product_id', editing.id)
            .in('id', removedAddons.map((a) => a.id));
          if (deleteAddonErr) {
            console.error('[Products] Failed to delete removed addons:', deleteAddonErr);
            toast.error('فشل تحديث الإضافات');
            return;
          }
        }

        for (const a of processedAddons) {
          if (a.id) {
            const { error: updErr } = await supabase
              .from('product_addons')
              .update({ name: a.name, price: a.price })
              .eq('product_id', editing.id)
              .eq('id', a.id);
            if (updErr) {
              console.error('[Products] Failed to update addon:', updErr);
              toast.error('فشل تحديث الإضافات');
              return;
            }
          } else {
            const { error: insErr } = await supabase.from('product_addons').insert({
              product_id: editing.id,
              name: a.name,
              price: a.price,
              is_available: true,
            });
            if (insErr) {
              console.error('[Products] Failed to insert new addon:', insErr);
              toast.error('فشل إضافة الإضافات');
              return;
            }
          }
        }

        const { data: refreshed } = await supabase
          .from('products')
          .select('*, product_addons(*)')
          .eq('id', editing.id)
          .single();

        if (refreshed) {
          onSaved(refreshed as ProductWithAddons, editing.id);
        }
        toast.success('تم تحديث المنتج');
        onClose();
        revalidateMenuCache(projectId);
      } else {
        const nextSortOrder = products.length ? Math.max(...products.map((p) => p.sort_order ?? 0)) + 1 : 0;
        const insertPayload: Database['public']['Tables']['products']['Insert'] = {
          project_id: projectId,
          name: name.trim(),
          name_en: nameEn.trim() || null,
          description: description.trim() || null,
          price: money(parsedPrice, currencyDecimals(currency)),
          category_id: categoryId || null,
          is_available: isAvailable,
          image_url: imageUrl.trim() || null,
          sort_order: nextSortOrder,
          stock: parseStockInput(stock),
        };
        const { data, error } = await supabase
          .from('products')
          .insert(insertPayload)
          .select('*')
          .single();

        if (error || !data) {
          toast.error('فشل الإضافة');
          return;
        }

        // Verify the new product belongs to this project before adding addons
        const { data: owned } = await supabase
          .from('products')
          .select('id')
          .eq('id', data.id)
          .eq('project_id', projectId)
          .maybeSingle();
        if (!owned) {
          toast.error('فشل الإضافة');
          return;
        }

        if (processedAddons.length > 0) {
          const { error: insAddonErr } = await supabase.from('product_addons').insert(
            processedAddons.map((a) => ({
              product_id: data.id,
              name: a.name,
              price: a.price,
              is_available: true,
            }))
          );
          if (insAddonErr) {
            console.error('[Products] Failed to insert addons:', insAddonErr);
            toast.error('أُضيف المنتج لكن فشلت الإضافات');
          }
        }

        const { data: withAddons } = await supabase
          .from('products')
          .select('*, product_addons(*)')
          .eq('id', data.id)
          .single();

        onSaved(
          (withAddons ?? { ...data, product_addons: [] }) as ProductWithAddons,
          null
        );
        toast.success('تمت إضافة المنتج');
        onClose();
        revalidateMenuCache(projectId);
      }
    } catch {
      console.error('[Products] saveProduct unexpected error');
      toast.error('خطأ غير متوقع — حاول مجددًا');
    } finally {
      setLoading(false);
    }
  }

  return (
    <Modal title={editing ? 'تعديل منتج' : 'منتج جديد'} onClose={onClose}>
      <form onSubmit={saveProduct} className="space-y-5">
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
            <label className="label">بالإنجليزي</label>
            <input
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
          <label className="label">الوصف</label>
          <textarea
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
            <label className="label">التصنيف</label>
            <div className="flex gap-1">
              <select
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

        {/* ======== ADDONS ======== */}
        <div className="rounded-[var(--radius-md)] border border-[var(--color-border)] bg-[var(--color-bg)] p-3">
          <div className="mb-3 flex items-center justify-between">
            <label className="label mb-0">الإضافات <span className="text-[var(--color-text-muted)]">(اختياري)</span></label>
            <button
              type="button"
              onClick={addFormAddon}
              className="btn btn-ghost btn-sm gap-1"
            >
              <Plus className="h-3.5 w-3.5" />
              إضافة
            </button>
          </div>

          {formAddons.length === 0 && (
            <p className="rounded-[var(--radius-md)] bg-[var(--color-surface)] px-3 py-4 text-center text-xs text-[var(--color-text-muted)]">
              ما فيه إضافات. أضف إضافات مثل {`{حليب، صوص، جبنة إضافية}`}
            </p>
          )}

          {formAddons.map((addon) => (
            <div
              key={addon.key}
              className="mb-2 flex items-center gap-2 rounded-[var(--radius-md)] bg-[var(--color-surface)] p-2"
            >
              <input
                className="input flex-1 text-sm"
                placeholder="اسم الإضافة"
                maxLength={50}
                value={addon.name}
                onChange={(e) => updateFormAddon(addon.key, 'name', e.target.value)}
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
                  value={addon.price}
                  onChange={(e) => updateFormAddon(addon.key, 'price', e.target.value)}
                />
              </div>
              <button
                type="button"
                onClick={() => removeFormAddon(addon.key)}
                aria-label={`حذف الإضافة ${addon.name || ''}`.trim()}
                className="btn btn-ghost btn-sm shrink-0 text-[var(--color-danger)]"
              >
                <Trash2 className="h-3.5 w-3.5" />
              </button>
            </div>
          ))}
        </div>

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
