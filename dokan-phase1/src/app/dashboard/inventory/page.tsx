import { requireCurrentProjectRole } from '@/lib/project';
import { createClient } from '@/lib/supabase/server';
import { InventoryClient } from './inventory-client';
import type {
  Ingredient,
  InventoryMovement,
  Product,
  ProductIngredient,
  Supplier,
} from '@/lib/types';

export const dynamic = 'force-dynamic';

export default async function InventoryPage() {
  const ctx = await requireCurrentProjectRole(['owner', 'manager']);
  const supabase = await createClient();

  const [
    { data: ingredients },
    { data: suppliers },
    { data: products },
    { data: recipes },
    { data: movements },
  ] = await Promise.all([
    supabase
      .from('ingredients')
      .select('*')
      .eq('project_id', ctx.project.id)
      .order('name'),
    supabase
      .from('suppliers')
      .select('*')
      .eq('project_id', ctx.project.id)
      .order('name'),
    supabase
      .from('products')
      .select('id, project_id, name, name_en, stock')
      .eq('project_id', ctx.project.id)
      .order('name'),
    supabase
      .from('product_ingredients')
      .select('*')
      .eq('project_id', ctx.project.id),
    supabase
      .from('inventory_movements')
      .select('*')
      .eq('project_id', ctx.project.id)
      .order('created_at', { ascending: false })
      .limit(50),
  ]);

  return (
    <InventoryClient
      projectId={ctx.project.id}
      ingredients={(ingredients ?? []) as Ingredient[]}
      suppliers={(suppliers ?? []) as Supplier[]}
      products={(products ?? []) as Pick<Product, 'id' | 'project_id' | 'name' | 'name_en' | 'stock'>[]}
      recipes={(recipes ?? []) as ProductIngredient[]}
      movements={(movements ?? []) as InventoryMovement[]}
    />
  );
}
