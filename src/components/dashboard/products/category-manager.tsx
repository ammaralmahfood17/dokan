'use client';

// FIX-C-001: CategoryManager — extracted VERBATIM from products-client.tsx.
// Category create / edit / delete-confirm modals. Presentational: parent owns
// the open-state + handlers, this renders the three dialogs.
import { Trash2 } from 'lucide-react';
import { Button } from '@/components/ui/button';
import { Modal } from '@/components/ui/modal';
import type { Category } from '@/lib/types';

export function CategoryManager({
  showCategoryForm,
  catName,
  setCatName,
  catError,
  setCatError,
  saveCategory,
  loading,
  onCloseCreate,
  editingCat,
  editCatName,
  setEditCatName,
  updateCategory,
  onCloseEdit,
  confirmDeleteCat,
  deleteCategory,
  onCloseDelete,
}: {
  showCategoryForm: boolean;
  catName: string;
  setCatName: (v: string) => void;
  catError: string;
  setCatError: (v: string) => void;
  saveCategory: (e: React.FormEvent) => void;
  loading: boolean;
  onCloseCreate: () => void;
  editingCat: Category | null;
  editCatName: string;
  setEditCatName: (v: string) => void;
  updateCategory: () => void;
  onCloseEdit: () => void;
  confirmDeleteCat: Category | null;
  deleteCategory: () => void;
  onCloseDelete: () => void;
}) {
  return (
    <>
      {showCategoryForm && (
        <Modal title="تصنيف جديد" onClose={onCloseCreate}>
          <form onSubmit={saveCategory} className="space-y-4">
            <div className="field">
              <label className="label" htmlFor="cat-name-new">اسم التصنيف</label>
              <input
                id="cat-name-new"
                className={`input ${catError ? 'input-error' : ''}`}
                aria-invalid={!!catError}
                aria-describedby={catError ? 'cat-name-new-error' : undefined}
                required
                maxLength={50}
                value={catName}
                onChange={(e) => {
                  setCatName(e.target.value);
                  if (catError) setCatError('');
                }}
                onBlur={() => {
                  if (!catName.trim()) setCatError('اسم التصنيف مطلوب');
                }}
                placeholder="مثال: مشروبات ساخنة"
                autoFocus
              />
              {catError && <p id="cat-name-new-error" className="error-text" role="alert">{catError}</p>}
            </div>
            <div className="flex gap-2">
              <Button type="submit" block disabled={loading || !catName.trim()}>
                {loading ? 'جاري…' : 'إنشاء'}
              </Button>
              <Button type="button" variant="secondary" onClick={onCloseCreate}>
                إلغاء
              </Button>
            </div>
          </form>
        </Modal>
      )}

      {editingCat && (
        <Modal title="تعديل التصنيف" onClose={onCloseEdit}>
          <form onSubmit={(e) => { e.preventDefault(); updateCategory(); }} className="space-y-4">
            <div className="field">
              <label htmlFor="category-name" className="label">اسم التصنيف</label>
              <input
                id="category-name"
                className="input"
                required
                maxLength={50}
                value={editCatName}
                onChange={(e) => setEditCatName(e.target.value)}
                autoFocus
              />
            </div>
            <div className="flex gap-2">
              <Button type="submit" block disabled={loading || !editCatName.trim()}>
                {loading ? 'جاري…' : 'حفظ'}
              </Button>
              <Button type="button" variant="secondary" onClick={onCloseEdit}>
                إلغاء
              </Button>
            </div>
          </form>
        </Modal>
      )}

      {confirmDeleteCat && (
        <Modal title="حذف التصنيف" onClose={onCloseDelete}>
          <div className="text-center">
            <div className="mb-3 mx-auto flex h-12 w-12 items-center justify-center rounded-full bg-[var(--color-danger-tint)]">
              <Trash2 className="h-6 w-6 text-[var(--color-danger)]" />
            </div>
            <p className="mb-1 text-sm font-bold">{confirmDeleteCat.name}</p>
            <p className="mb-5 text-xs text-[var(--color-text-secondary)]">
              هل أنت متأكد؟ المنتجات المرتبطة بهذا التصنيف ستبقى بدون تصنيف.
            </p>
            <div className="flex gap-2">
              <Button variant="danger" block disabled={loading} onClick={deleteCategory}>
                {loading ? 'جاري…' : 'نعم، احذف'}
              </Button>
              <Button variant="secondary" onClick={onCloseDelete}>
                إلغاء
              </Button>
            </div>
          </div>
        </Modal>
      )}
    </>
  );
}
