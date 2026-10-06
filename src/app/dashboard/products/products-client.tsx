'use client';

import { useCallback, useDeferredValue, useMemo, useRef, useState } from 'react';
import { Plus, Trash2, Check } from 'lucide-react';
import { createClient } from '@/lib/supabase/client';
import { formatMoney, money, currencyDecimals } from '@/lib/utils';
import { Button } from '@/components/ui/button';
import { EmptyState } from '@/components/ui/empty-state';
import { Modal } from '@/components/ui/modal';
import { PullToRefresh } from '@/components/ui/pull-to-refresh';
import { Toggle } from '@/components/ui/toggle';
import type { Category, Product, ProductOptionChoice } from '@/lib/types';
import type { Database } from '@/lib/database.types';
import { useRouter } from 'next/navigation';
import { toast } from 'sonner';

/**
 * M5: after any product/category mutation, purge the public menu cache for
 * this project so the live QR menu reflects the change immediately instead of
 * after the 60s ISR window. Fire-and-forget — cache purge must never block or
 * fail the user's action. The endpoint re-checks membership server-side.
 */
// FIX-C-001: helpers مستخرجة (validate/remove/compress)
// FIX-C-003 (audit 2.4): revalidateMenuCache انتقلت لنفس الملف (تحتاجها
// المكونات/الخطافات المستخرجة الآن) — نقل حرفي بدون تغيير سلوك
import { validateProduct, removeProductImage, compressImage, revalidateMenuCache, type FieldErrors } from '@/lib/products-utils';
// FIX-C-001: مكوّن رفع الصور مستخرج
import { ImageUploader } from '@/components/dashboard/products/image-uploader';
// FIX-C-001: نموذج المنتج مستخرج
import { ProductFormModal } from '@/components/dashboard/products/product-form-modal';
// FIX-C-001: modals التصنيفات مستخرجة
import { CategoryManager } from '@/components/dashboard/products/category-manager';
// FIX-C-003 (audit 2.4): البطاقة + شريط الفلترة + خطافا.bulk والتصنيفات مستخرجة — نقل حرفي
import { ProductCard, type ProductWithOptions } from '@/components/dashboard/products/product-card';
import { CategoryFilterBar } from '@/components/dashboard/products/category-filter-bar';
import { useProductBulk } from '@/components/dashboard/products/use-product-bulk';
import { useCategoryCrud } from '@/components/dashboard/products/use-category-crud';

/** Temporary addon line in the product form — id is set for existing (persisted) addons */
type FormAddon = { key: string; id?: string; name: string; price: string };

/** Best-effort: delete the storage object behind a product image URL (ignore failures) */
export function ProductsClient({
  projectId,
  currency,
  initialCategories,
  initialProducts,
}: {
  projectId: string;
  currency: string;
  initialCategories: Category[];
  initialProducts: ProductWithOptions[];
}) {
  const router = useRouter();
  const [categories, setCategories] = useState(initialCategories);
  const [products, setProducts] = useState(initialProducts);
  const [showProductForm, setShowProductForm] = useState(false);
  const [editing, setEditing] = useState<ProductWithOptions | null>(null);

  // Search + category filter
  const [searchQuery, setSearchQuery] = useState('');
  // FIX-P-002: تأجيل الفلترة — لا تحجب الـ main thread أثناء الكتابة
  const deferredSearch = useDeferredValue(searchQuery);
  const [activeCat, setActiveCat] = useState<string | null>(null);

  const sortedProducts = useMemo(
    () => [...products].sort((a, b) => a.sort_order - b.sort_order),
    [products]
  );

  const filteredProducts = useMemo(() => {
    let list = sortedProducts;
    if (activeCat) {
      list = list.filter((p) => p.category_id === activeCat);
    }
    if (deferredSearch.trim()) {
      const q = deferredSearch.trim().toLowerCase();
      list = list.filter(
        (p) =>
          p.name.toLowerCase().includes(q) ||
          (p.name_en ?? '').toLowerCase().includes(q)
      );
    }
    return list;
  }, [sortedProducts, activeCat, deferredSearch]);

  // Live product counts per category (updates as products change).
  const categoryCounts = useMemo(() => {
    const counts = new Map<string, number>();
    for (const p of sortedProducts) {
      if (!p.category_id) continue;
      counts.set(p.category_id, (counts.get(p.category_id) ?? 0) + 1);
    }
    return counts;
  }, [sortedProducts]);

  function openCreate() {
    // FIX-C-001: النموذج يهيئ حالته من editing (null = جديد)
    setEditing(null);
    setShowProductForm(true);
  }

  function openEdit(p: ProductWithOptions) {
    // FIX-C-001: النموذج يهيئ حالته من editing
    setEditing(p);
    setShowProductForm(true);
  }

  // Delete confirmation state
  const [confirmDelete, setConfirmDelete] = useState<ProductWithOptions | null>(null);

  async function deleteProduct(id: string) {
    const supabase = createClient();
    const product = products.find((p) => p.id === id);
    const { error } = await supabase.from('products').delete().eq('id', id).eq('project_id', projectId);
    if (error) {
      toast.error('فشل الحذف');
      return;
    }
    setProducts((prev) => prev.filter((p) => p.id !== id));
    toast.success('تم حذف المنتج');
    removeProductImage(product?.image_url);
    revalidateMenuCache(projectId);
  }

  // (The per-addon delete handler that used to live here is gone: options are
  // edited inside the product form, and `product_addons` no longer exists.)

  // FIX-C-003 (audit 2.4): CRUD التصنيفات مستخرج كما هو (يغذّي CategoryManager)
  const categoryCrud = useCategoryCrud({ projectId, categories, setCategories });

  // FIX-C-003 (audit 2.4): التحديد الجماعي مستخرج كما هو
  const bulk = useProductBulk({ projectId, visibleProducts: filteredProducts, setProducts });

  const refresh = useCallback(async () => { router.refresh(); }, [router]);

  return (
    <div className="page">
      <PullToRefresh onRefresh={refresh}>
      <div className="page-header">
        <div>
          <h1>المنتجات</h1>
          <p>إدارة التصنيفات والمنتجات والخيارات</p>
        </div>
        <div className="flex flex-wrap gap-2">
          {bulk.bulkMode ? (
            <>
              <Button variant="secondary" size="sm" onClick={bulk.exitBulk}>
                إلغاء التحديد
              </Button>
              <Button size="sm" onClick={openCreate}>
                <Plus className="h-4 w-4" />
                منتج جديد
              </Button>
            </>
          ) : (
            <>
              <Button variant="secondary" size="sm" onClick={() => bulk.setBulkMode(true)}>
                تحديد
              </Button>
              <Button variant="secondary" size="sm" onClick={categoryCrud.openCategoryForm}>
                تصنيف جديد
              </Button>
              <Button size="sm" onClick={openCreate}>
                <Plus className="h-4 w-4" />
                منتج جديد
              </Button>
            </>
          )}
        </div>
      </div>

      {/* Search + category chips — FIX-C-003: شريط الفلترة مستخرج */}
      <CategoryFilterBar
        searchQuery={searchQuery}
        onSearchChange={setSearchQuery}
        activeCat={activeCat}
        onPickCat={setActiveCat}
        categories={categories}
        totalCount={sortedProducts.length}
        counts={categoryCounts}
        onEditCategory={(c) => { categoryCrud.setEditingCat(c); categoryCrud.setEditCatName(c.name); }}
        onDeleteCategory={(c) => categoryCrud.setConfirmDeleteCat(c)}
      />

      {!filteredProducts.length ? (
        <EmptyState
          title={searchQuery || activeCat ? 'لا توجد نتائج' : 'ما فيه منتجات حالياً'}
          description={searchQuery || activeCat ? 'جرب تغيير كلمات البحث أو إلغاء الفلتر.' : 'أضف أول منتج وبيّن للعملاء قائمتك.'}
          action={
            <Button onClick={openCreate}>
              <Plus className="h-4 w-4" />
              أضف أول منتج
            </Button>
          }
        />
      ) : (
        <>
          {/* FIX-P-003: containment لعزل الشبكة الثقيلة */}
          <div className="product-grid grid grid-cols-[repeat(auto-fill,minmax(160px,1fr))] gap-3">
            {filteredProducts.map((p) => (
              <ProductCard
                key={p.id}
                product={p}
                currency={currency}
                bulkMode={bulk.bulkMode}
                selected={bulk.selectedIds.has(p.id)}
                onOpen={() => openEdit(p)}
                onToggleSelect={() => bulk.toggleSelect(p.id)}
              />
            ))}
          </div>

          {/* Bulk action bar */}
          {bulk.bulkMode && (
            <div className="sticky bottom-3 z-[var(--z-sticky)] mt-4 flex items-center justify-between gap-2 rounded-[10px] border border-[var(--color-border)] bg-[var(--color-surface)] p-2 shadow-float">
              <button
                type="button"
                onClick={bulk.toggleSelectAllVisible}
                className="flex min-h-[44px] items-center gap-2 rounded-[var(--radius-md)] px-3 text-sm font-semibold text-[var(--color-text-secondary)]"
              >
                <span
                  className={`flex h-5 w-5 items-center justify-center rounded border-2 ${
                    bulk.allVisibleSelected
                      ? 'border-[var(--color-primary)] bg-[var(--color-primary)] text-white'
                      : 'border-[var(--color-border)]'
                  }`}
                >
                  {bulk.allVisibleSelected && <Check className="h-3 w-3" />}
                </span>
                {bulk.allVisibleSelected ? 'إلغاء الكل' : 'اختيار الكل'}
              </button>
              <div className="flex gap-1">
                <button
                  type="button"
                  onClick={() => bulk.bulkSetAvailability(true)}
                  disabled={bulk.bulkBusy || bulk.selectedIds.size === 0}
                  className="btn btn-secondary btn-sm"
                >
                  تفعيل
                </button>
                <button
                  type="button"
                  onClick={() => bulk.bulkSetAvailability(false)}
                  disabled={bulk.bulkBusy || bulk.selectedIds.size === 0}
                  className="btn btn-secondary btn-sm"
                >
                  إيقاف
                </button>
                <button
                  type="button"
                  onClick={() => bulk.setConfirmBulkDelete(true)}
                  disabled={bulk.bulkBusy || bulk.selectedIds.size === 0}
                  className="btn btn-danger btn-sm"
                >
                  حذف
                </button>
              </div>
            </div>
          )}
        </>
      )}

      </PullToRefresh>

      {/* ======== PRODUCT FORM MODAL — FIX-C-001: extracted component ======== */}
      {showProductForm && (
        <ProductFormModal
          projectId={projectId}
          currency={currency}
          categories={categories}
          products={products}
          editing={editing}
          onClose={() => setShowProductForm(false)}
          onSaved={(product, editingId) => {
            // FIX-C-001: تحديث القائمة من النموذج المستخرج
            setProducts((prev) =>
              editingId
                ? prev.map((p) => (p.id === editingId ? product : p))
                : [...prev, product]
            );
          }}
          onRequestDelete={(p) => {
            setShowProductForm(false);
            setConfirmDelete(p);
          }}
        />
      )}

      {/* ======== CATEGORY MODALS — FIX-C-001: extracted component ======== */}
      <CategoryManager
        showCategoryForm={categoryCrud.showCategoryForm}
        catName={categoryCrud.catName}
        setCatName={categoryCrud.setCatName}
        catError={categoryCrud.catError}
        setCatError={categoryCrud.setCatError}
        saveCategory={categoryCrud.saveCategory}
        loading={categoryCrud.loading}
        onCloseCreate={() => categoryCrud.setShowCategoryForm(false)}
        editingCat={categoryCrud.editingCat}
        editCatName={categoryCrud.editCatName}
        setEditCatName={categoryCrud.setEditCatName}
        updateCategory={categoryCrud.updateCategory}
        onCloseEdit={() => categoryCrud.setEditingCat(null)}
        confirmDeleteCat={categoryCrud.confirmDeleteCat}
        deleteCategory={categoryCrud.deleteCategory}
        onCloseDelete={() => categoryCrud.setConfirmDeleteCat(null)}
      />

      {/* FIX-DEL-001: the single-product confirm modal was LOST in the
          FIX-C-001 extraction — the form modal's «حذف» button set
          confirmDelete and deleteProduct existed, but nothing ever rendered
          the confirmation, so deleting one product was a silent no-op.
          Restores the flow (same pattern/wording as the bulk-delete modal). */}
      {confirmDelete && (
        <Modal title="حذف المنتج" onClose={() => setConfirmDelete(null)}>
          <div className="text-center">
            <div className="mx-auto mb-3 flex h-12 w-12 items-center justify-center rounded-full bg-[var(--color-danger-tint)]">
              <Trash2 className="h-6 w-6 text-[var(--color-danger)]" />
            </div>
            <p className="mb-5 text-xs text-[var(--color-text-secondary)]">
              هل أنت متأكد من حذف «{confirmDelete.name}»؟ لا يمكن التراجع.
            </p>
            <div className="flex gap-2">
              <Button
                variant="danger"
                block
                onClick={() => {
                  deleteProduct(confirmDelete.id);
                  setConfirmDelete(null);
                }}
              >
                نعم، احذف
              </Button>
              <Button variant="secondary" onClick={() => setConfirmDelete(null)}>
                إلغاء
              </Button>
            </div>
          </div>
        </Modal>
      )}

      {bulk.confirmBulkDelete && (
        <Modal title="حذف المنتجات المحددة" onClose={() => bulk.setConfirmBulkDelete(false)}>
          <div className="text-center">
            <div className="mx-auto mb-3 flex h-12 w-12 items-center justify-center rounded-full bg-[var(--color-danger-tint)]">
              <Trash2 className="h-6 w-6 text-[var(--color-danger)]" />
            </div>
            <p className="mb-5 text-xs text-[var(--color-text-secondary)]">
              هل أنت متأكد؟ هذا الإجراء لا يمكن التراجع عنه.
            </p>
            <div className="flex gap-2">
              <Button
                variant="danger"
                block
                disabled={bulk.bulkBusy}
                onClick={bulk.bulkDelete}
              >
                {bulk.bulkBusy ? 'جاري…' : 'نعم، احذف'}
              </Button>
              <Button variant="secondary" onClick={() => bulk.setConfirmBulkDelete(false)}>
                إلغاء
              </Button>
            </div>
          </div>
        </Modal>
      )}
    </div>
  );
}
