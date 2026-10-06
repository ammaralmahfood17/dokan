'use client';

// FIX-C-003 (audit 2.4): useProductBulk — extracted verbatim from
// products-client.tsx. Bulk-select mode over the FILTERED grid: selection
// set, select-all-visible, availability toggle, and delete (scoped to the
// project on every write). No behavior change.
import { Dispatch, SetStateAction, useState } from 'react';
import { createClient } from '@/lib/supabase/client';
import { revalidateMenuCache } from '@/lib/products-utils';
import type { ProductWithOptions } from '@/components/dashboard/products/product-card';
import { toast } from 'sonner';

export function useProductBulk({
  projectId,
  visibleProducts,
  setProducts,
}: {
  projectId: string;
  visibleProducts: ProductWithOptions[];
  setProducts: Dispatch<SetStateAction<ProductWithOptions[]>>;
}) {
  const [bulkMode, setBulkMode] = useState(false);
  const [selectedIds, setSelectedIds] = useState<Set<string>>(new Set());
  const [bulkBusy, setBulkBusy] = useState(false);
  const [confirmBulkDelete, setConfirmBulkDelete] = useState(false);

  function exitBulk() {
    setBulkMode(false);
    setSelectedIds(new Set());
  }

  function toggleSelect(id: string) {
    setSelectedIds((prev) => {
      const next = new Set(prev);
      if (next.has(id)) next.delete(id);
      else next.add(id);
      return next;
    });
  }

  const visibleIds = visibleProducts.map((p) => p.id);
  const allVisibleSelected =
    visibleIds.length > 0 && visibleIds.every((id) => selectedIds.has(id));

  function toggleSelectAllVisible() {
    setSelectedIds((prev) => {
      const next = new Set(prev);
      if (allVisibleSelected) {
        for (const id of visibleIds) next.delete(id);
      } else {
        for (const id of visibleIds) next.add(id);
      }
      return next;
    });
  }

  async function bulkSetAvailability(available: boolean) {
    if (selectedIds.size === 0) return;
    setBulkBusy(true);
    try {
      const supabase = createClient();
      const { error } = await supabase
        .from('products')
        .update({ is_available: available })
        .in('id', [...selectedIds])
        .eq('project_id', projectId);
      if (error) {
        toast.error('فشل التحديث');
        return;
      }
      setProducts((prev) =>
        prev.map((p) =>
          selectedIds.has(p.id) ? { ...p, is_available: available } : p
        )
      );
      toast.success(available ? 'تم تفعيل المنتجات' : 'تم إيقاف المنتجات');
      exitBulk();
      revalidateMenuCache(projectId);
    } finally {
      setBulkBusy(false);
    }
  }

  async function bulkDelete() {
    if (selectedIds.size === 0) return;
    setBulkBusy(true);
    try {
      const supabase = createClient();
      const { error } = await supabase
        .from('products')
        .delete()
        .in('id', [...selectedIds])
        .eq('project_id', projectId);
      setConfirmBulkDelete(false);
      if (error) {
        toast.error('فشل الحذف');
        return;
      }
      setProducts((prev) => prev.filter((p) => !selectedIds.has(p.id)));
      toast.success('تم حذف المنتجات');
      exitBulk();
      revalidateMenuCache(projectId);
    } finally {
      setBulkBusy(false);
    }
  }

  return {
    bulkMode,
    setBulkMode,
    selectedIds,
    bulkBusy,
    confirmBulkDelete,
    setConfirmBulkDelete,
    exitBulk,
    toggleSelect,
    allVisibleSelected,
    toggleSelectAllVisible,
    bulkSetAvailability,
    bulkDelete,
  };
}
