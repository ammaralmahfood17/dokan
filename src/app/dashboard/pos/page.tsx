import { redirect } from 'next/navigation';
import dynamic from 'next/dynamic';
import { getCurrentProject } from '@/lib/project';
import { createClient } from '@/lib/supabase/server';
import type { Product, ProductOptionGroup } from '@/lib/types';

type ProductWithOptions = Product & { option_groups: ProductOptionGroup[] };

/**
 * Dynamic import: PosClient lives in its own JS chunk.
 * It only loads when the user actually visits /dashboard/pos.
 * The skeleton shows instantly while the chunk downloads + hydrates.
 */
const PosClient = dynamic<{
  projectId: string;
  currency: string;
  products: (Product & { option_groups: ProductOptionGroup[] })[];
  // UX-U12: تكرار المنتجات
  productFrequency?: Record<string, number>;
}>(
  () => import('./pos-client').then((mod) => ({ default: mod.PosClient })),
  {
    ssr: true,
    loading: () => <PosLoader />,
  }
);

function PosLoader() {
  return (
    <div className="page md:max-w-[1440px]">
      <div className="page-header">
        <div>
          <h1>نقطة البيع</h1>
          <p>جاري التحميل…</p>
        </div>
      </div>
      <div className="md:grid md:grid-cols-[minmax(0,1fr)_380px] md:items-start md:gap-4">
        <div className="min-w-0">
          <div className="mb-3 flex gap-1 rounded-[var(--radius-md)] bg-[var(--color-surface-sunken)] p-1">
            {[0, 1, 2].map((i) => (
              <div key={i} className="h-11 flex-1 rounded-[6px] bg-[var(--color-surface)]" />
            ))}
          </div>
          <div className="mb-3 flex gap-2">
            <div className="h-11 flex-1 rounded-[var(--radius-md)] border border-[var(--color-border)] bg-[var(--color-surface)]" />
            <div className="h-11 flex-1 rounded-[var(--radius-md)] border border-[var(--color-border)] bg-[var(--color-surface)]" />
          </div>
          <div className="grid grid-cols-[repeat(auto-fill,minmax(140px,1fr))] gap-3">
            {Array.from({ length: 8 }).map((_, i) => (
              <div
                key={i}
                className="overflow-hidden rounded-[var(--radius-md)] border border-[var(--color-border)] bg-[var(--color-surface)]"
              >
                <div className="aspect-[4/3] w-full animate-pulse bg-[var(--color-surface-sunken)]" />
                <div className="space-y-2 p-2.5">
                  <div className="h-3 w-3/4 animate-pulse rounded bg-[var(--color-border)]" />
                  <div className="h-4 w-1/2 animate-pulse rounded bg-[var(--color-border)]" />
                </div>
              </div>
            ))}
          </div>
        </div>
        <aside className="hidden md:block">
          <div className="h-[calc(100dvh-57px)] rounded-[10px] border border-[var(--color-border)] bg-[var(--color-surface)] p-4 lg:h-dvh">
            <div className="h-6 w-20 animate-pulse rounded bg-[var(--color-border)]" />
            <div className="mt-6 space-y-4">
              {Array.from({ length: 4 }).map((_, i) => (
                <div key={i} className="space-y-2">
                  <div className="h-11 w-full animate-pulse rounded-[var(--radius-md)] bg-[var(--color-surface-sunken)]" />
                  <div className="h-3 w-2/3 animate-pulse rounded bg-[var(--color-border)]" />
                </div>
              ))}
            </div>
            <div className="mt-8 h-11 w-full animate-pulse rounded-[var(--radius-md)] bg-[var(--color-primary-tint)]" />
          </div>
        </aside>
      </div>
    </div>
  );
}

export default async function PosPage() {
  const ctx = await getCurrentProject();
  if (!ctx) redirect('/onboarding');

  const supabase = await createClient();
  const { data: products } = await supabase
    .from('products')
    .select('*, option_groups(*, option_choices(*))')
    .eq('project_id', ctx.project.id)
    .order('sort_order');

  // UX-U12: تعلم المنتجات المتكررة — عدد طلبات آخر 7 أيام لكل منتج
  // (يُستخدم لتصدر الأصناف الأكثر طلبًا في شبكة POS)
  const since = new Date(new Date().getTime() - 7 * 86400e3).toISOString();
  const { data: orderRows } = await supabase
    .from('orders')
    .select('order_items(product_id)')
    .eq('project_id', ctx.project.id)
    .is('service_type', null)
    .gte('created_at', since);
  const frequency: Record<string, number> = {};
  for (const o of orderRows ?? []) {
    for (const it of (o as { order_items?: { product_id: string | null }[] }).order_items ?? []) {
      if (it.product_id) frequency[it.product_id] = (frequency[it.product_id] ?? 0) + 1;
    }
  }

  return (
    <PosClient
      projectId={ctx.project.id}
      currency={ctx.project.currency}
      products={
        (products ?? []) as (Product & { option_groups: ProductOptionGroup[] })[]
      }
      productFrequency={frequency}
    />
  );
}
