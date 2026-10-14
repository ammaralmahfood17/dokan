/**
 * Shared public-project resolution — DRY between storefront and menu pages.
 * Both need the same slug→project resolution with the RPC availability
 * check, anon client, and column-scoped select list.
 */
import { createAnonClient } from '@/lib/supabase/anon';
import type { Project } from '@/lib/types';

export async function getPublicProject(
  slug: string,
): Promise<(Pick<Project, 'id' | 'name' | 'slug' | 'currency' | 'primary_color' | 'logo_url' | 'is_active'>) | null> {
  const supabase = createAnonClient();

  // The availability RPC and the row read are independent (both take only the
  // slug), so they share ONE barrier instead of costing two on every storefront
  // and menu render. The RPC keeps its VETO: the row is discarded when it says
  // no, which is what makes an expired subscription invisible even though the
  // project row itself is still `is_active`.
  const [{ data: isAvailable }, { data: project }] = await Promise.all([
    // HARD subscription check — anon can't read subscription_expires_at (0006
    // column-scoped grants). The SECURITY DEFINER RPC does the exact cutoff.
    supabase.rpc('is_project_publicly_available', { p_slug: slug }),
    // Explicit column list: anon has column-scoped grants on projects (0006).
    supabase
      .from('projects')
      .select('id, name, slug, currency, primary_color, logo_url, is_active')
      .eq('slug', slug)
      .eq('is_active', true)
      .maybeSingle(),
  ]);

  if (!isAvailable) return null;
  return project ?? null;
}