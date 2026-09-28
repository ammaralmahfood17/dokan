import { requireCurrentProjectRole } from '@/lib/project';
import { createClient } from '@/lib/supabase/server';
import { ProductsClient } from './products-client';
import type { Category, Product, ProductAddon } from '@/lib/types';

export default async function ProductsPage() {
  const ctx = await requireCurrentProjectRole(['owner', 'manager']);

  const supabase = await createClient();

  const [{ data: categories }, { data: products }] = await Promise.all([
    supabase
      .from('categories')
      .select('*')
      .eq('project_id', ctx.project.id)
      .order('sort_order'),
    supabase
      .from('products')
      .select('*, product_addons(*)')
      .eq('project_id', ctx.project.id)
      .order('sort_order'),
  ]);

  return (
    <ProductsClient
      projectId={ctx.project.id}
      currency={ctx.project.currency}
      initialCategories={(categories ?? []) as Category[]}
      initialProducts={
        (products ?? []) as (Product & { product_addons: ProductAddon[] })[]
      }
    />
  );
}
