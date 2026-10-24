'use client';

import { useMemo, useState } from 'react';
import { AlertCircle, ClipboardPaste, Sparkles } from 'lucide-react';
import { Modal } from '@/components/ui/modal';
import { Button } from '@/components/ui/button';
import { createClient } from '@/lib/supabase/client';
import { revalidateMenuCache } from '@/lib/products-utils';
import { formatMoney } from '@/lib/utils';
import { parseMenuText } from '@/lib/menu-import';
import type { Category } from '@/lib/types';
import { toast } from 'sonner';

/**
 * The owner's first five minutes: paste the menu they already have and get
 * products. This is the activation path — a merchant who types 40 dishes by
 * hand never finishes onboarding.
 *
 * Writes go through the browser client (RLS decides who may write), in two
 * batches: missing categories first, then the products. Names already on the
 * menu are skipped and reported, never silently duplicated.
 */
export function MenuImportModal({
  projectId,
  currency,
  categories,
  existingNames,
  onClose,
  onImported,
}: {
  projectId: string;
  currency: string;
  categories: Category[];
  existingNames: string[];
  onClose: () => void;
  onImported: () => void;
}) {
  const [text, setText] = useState('');
  const [busy, setBusy] = useState(false);

  const parsed = useMemo(() => parseMenuText(text), [text]);

  const existing = useMemo(
    () => new Set(existingNames.map(normalize)),
    [existingNames],
  );

  const fresh = parsed.items.filter((item) => !existing.has(normalize(item.name)));
  const skipped = parsed.items.length - fresh.length;

  const newCategories = useMemo(() => {
    const known = new Set(categories.map((c) => normalize(c.name)));
    const seen = new Set<string>();
    return fresh
      .map((i) => i.category)
      .filter((name): name is string => Boolean(name))
      .filter((name) => {
        const key = normalize(name);
        if (known.has(key) || seen.has(key)) return false;
        seen.add(key);
        return true;
      });
  }, [fresh, categories]);

  async function importMenu() {
    if (!fresh.length || busy) return;
    setBusy(true);
    const supabase = createClient();

    try {
      const categoryIds = new Map<string, string>();
      categories.forEach((c) => categoryIds.set(normalize(c.name), c.id));

      if (newCategories.length) {
        const baseOrder = categories.reduce((max, c) => Math.max(max, c.sort_order), 0);
        const { data, error } = await supabase
          .from('categories')
          .insert(
            newCategories.map((name, i) => ({
              project_id: projectId,
              name,
              sort_order: baseOrder + i + 1,
            })),
          )
          .select('id, name');
        if (error) throw error;
        (data ?? []).forEach((row) => categoryIds.set(normalize(row.name), row.id));
      }

      let sortOrder = 0;
      const rows = fresh.map((item) => ({
        project_id: projectId,
        name: item.name,
        price: item.price,
        category_id: item.category ? (categoryIds.get(normalize(item.category)) ?? null) : null,
        sort_order: sortOrder++,
      }));

      const { error } = await supabase.from('products').insert(rows);
      if (error) throw error;

      revalidateMenuCache(projectId);
      toast.success(
        `أضفنا ${rows.length} منتج${newCategories.length ? ` و${newCategories.length} تصنيف` : ''}`,
      );
      onImported();
    } catch (err) {
      toast.error(err instanceof Error && err.message ? err.message : 'تعذّر الاستيراد، جرّب مرة ثانية');
    } finally {
      setBusy(false);
    }
  }

  return (
    <Modal title="استيراد المنيو" onClose={onClose}>
      <div className="flex flex-col gap-4">
        <p className="text-sm leading-relaxed text-[var(--color-text-secondary)]">
          الصق قائمة الأكل من الواتساب أو ملف الوورد. كل سطر: <span className="font-semibold">الاسم ثم السعر</span>.
          التصنيفات مثل <span className="font-semibold">[مشروبات]</span> تصير أقسام.
        </p>

        <label className="flex flex-col gap-2">
          <span className="text-sm font-semibold">المنيو</span>
          <textarea
            value={text}
            onChange={(e) => setText(e.target.value)}
            maxLength={20000}
            rows={9}
            spellCheck={false}
            placeholder={'شاورما دجاج 1.500\nبرجر لحم 2.200\n[مشروبات]\nعصير برتقال 0.800'}
            className="min-h-[180px] w-full rounded-[var(--radius-md)] border border-[var(--color-border)] bg-[var(--color-surface)] p-3 text-base leading-relaxed"
          />
        </label>

        <div className="rounded-[var(--radius-md)] border border-[var(--color-border)] bg-[var(--color-surface-sunken)] p-3 text-sm">
          {parsed.items.length === 0 ? (
            <span className="flex items-center gap-2 text-[var(--color-text-secondary)]">
              <ClipboardPaste className="h-4 w-4 shrink-0" />
              جاهزين — الصق المنيو فوق وبنعرض لك المعاينة هنا.
            </span>
          ) : (
            <div className="flex flex-col gap-2">
              <span className="flex items-center gap-2 font-semibold">
                <Sparkles className="h-4 w-4 shrink-0" />
                {fresh.length} منتج جاهز للإضافة
                {newCategories.length > 0 && ` · ${newCategories.length} تصنيف جديد`}
                {skipped > 0 && ` · ${skipped} موجود مسبقاً`}
              </span>
              <ul className="flex flex-col gap-1">
                {fresh.slice(0, 5).map((item) => (
                  <li key={`${item.line}-${item.name}`} className="flex items-center justify-between gap-3">
                    <span className="truncate">
                      {item.category ? `${item.category} · ` : ''}
                      {item.name}
                    </span>
                    <span className="shrink-0 tabular-nums text-[var(--color-text-secondary)]">
                      {formatMoney(item.price, currency)}
                    </span>
                  </li>
                ))}
                {fresh.length > 5 && (
                  <li className="text-[var(--color-text-secondary)]">و{fresh.length - 5} منتج آخر…</li>
                )}
              </ul>
            </div>
          )}
        </div>

        {parsed.errors.length > 0 && (
          <div className="rounded-[var(--radius-md)] border border-[var(--color-warn)] bg-[var(--color-warn-tint)] p-3 text-sm">
            <span className="flex items-center gap-2 font-semibold">
              <AlertCircle className="h-4 w-4 shrink-0" />
              {parsed.errors.length} سطر ما قدرنا نقرأه
            </span>
            <ul className="mt-2 flex flex-col gap-1 text-[var(--color-text-secondary)]">
              {parsed.errors.slice(0, 4).map((err) => (
                <li key={err.line} className="truncate">
                  سطر {err.line}: {err.raw}
                </li>
              ))}
              {parsed.errors.length > 4 && <li>و{parsed.errors.length - 4} سطر آخر…</li>}
            </ul>
          </div>
        )}

        <div className="flex flex-col-reverse gap-2 sm:flex-row sm:justify-end">
          <Button variant="secondary" onClick={onClose} disabled={busy}>
            إلغاء
          </Button>
          <Button onClick={importMenu} isLoading={busy} disabled={!fresh.length}>
            {fresh.length ? `أضف ${fresh.length} منتج` : 'أضف المنتجات'}
          </Button>
        </div>
      </div>
    </Modal>
  );
}

/** Arabic-aware comparison key: whitespace, alef forms and taa marbuta. */
function normalize(name: string): string {
  return name
    .trim()
    .replace(/\s+/g, ' ')
    .replace(/[أإآ]/g, 'ا')
    .replace(/ى/g, 'ي')
    .replace(/ة/g, 'ه')
    .toLowerCase();
}
