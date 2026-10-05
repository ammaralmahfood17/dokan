import { notFound } from 'next/navigation';
import { unstable_cache } from 'next/cache';
import type { Metadata } from 'next';
import { createAnonClient } from '@/lib/supabase/anon';
import { getSiteUrl } from '@/lib/site-url';
import { getPublicProject } from '@/lib/public-project';
import { MenuClient } from './menu-client';
import type { Category, Product, ProductAddon, Project, Table } from '@/lib/types';

// The page itself is DYNAMIC (no `export const revalidate`): the subscription
// cutoff flips projects.is_active=false and that must cut the public menu
// IMMEDIATELY, not up to 60s later (a cached page would keep serving a
// deactivated store). Performance is preserved by unstable_cache on the menu
// queries below (60s, project-tagged, purged on edit via /api/revalidate-menu).
export const dynamicParams = true;

// M5: on-demand invalidation. Product/category edits call
// /api/revalidate-menu, which revalidateTag()s `menu-${projectId}`. The menu
// queries below are cached under that project-scoped tag, so an edit shows on
// the live QR menu immediately instead of waiting up to 60s (or longer with
// SWR). Wrapped in a function so the tag can be project-scoped (unstable_cache
// options are evaluated per call).
async function getMenuData(projectId: string, tableId: string) {
  return unstable_cache(
    async () => {
      const supabase = createAnonClient();
      const [{ data: categories }, { data: products }] = await Promise.all([
        supabase
          .from('categories')
          .select('id, name, sort_order, is_active')
          .eq('project_id', projectId)
          .eq('is_active', true)
          .order('sort_order', { ascending: true }),
        // UX-6 (0011): sold-out items are fetched too and rendered greyed-out
        // with a «غير متوفر» badge instead of vanishing from the menu. Order
        // safety is server-side: createSecureOrder rejects unavailable items.
        supabase
          .from('products')
          .select('*, product_addons(*)')
          .eq('project_id', projectId)
          .order('is_available', { ascending: false })
          .order('sort_order'),
      ]);
      return {
        categories: (categories ?? []) as Category[],
        products: (products ?? []) as (Product & { product_addons: ProductAddon[] })[],
      };
    },
    ['menu-data', projectId, tableId],
    { revalidate: 60, tags: [`menu-${projectId}`] }
  )();
}

// Enable ISR for any slug combination: without generateStaticParams, async
// `params` force dynamic rendering (cache-control: no-store) regardless of
// revalidate. An empty list + dynamicParams=true opts into on-demand
// static generation: first visit builds the page, then it's cached & revalidated.
export async function generateStaticParams() {
  return [];
}

// A2/UX-report: every public menu served under 3 hostnames had no canonical —
// search engines saw duplicates. Store name also becomes the tab/OG title.
export async function generateMetadata({
  params,
}: {
  params: Promise<{ projectSlug: string; tableSlug: string }>;
}): Promise<Metadata> {
  const { projectSlug, tableSlug } = await params;
  const project = await getPublicProject(projectSlug);
  return {
    title: project?.name ? `${project.name} — القائمة` : 'القائمة',
    alternates: {
      canonical: `${getSiteUrl()}/${projectSlug}/menu/${tableSlug}`,
    },
  };
}

export default async function PublicMenuPage({
  params,
  searchParams,
}: {
  params: Promise<{ projectSlug: string; tableSlug: string }>;
  searchParams: Promise<{ k?: string }>;
}) {
  const { projectSlug, tableSlug } = await params;
  const { k } = await searchParams;
  // anon client (no user cookies) → RLS anon role → public menu data,
  // so signed-in users see other restaurants' menus too
  const supabase = createAnonClient();

  const project = await getPublicProject(projectSlug);
  if (!project) notFound();

  // Resolve active table inside project
  const { data: table } = await supabase
    .from('tables')
    .select('id, number, slug, is_active, project_id')
    .eq('project_id', project.id)
    .eq('slug', tableSlug)
    .eq('is_active', true)
    .maybeSingle();

  if (!table) notFound();

  // Audit 2026-10-05 (T2 #1): ordering requires the table's scan token. `anon` cannot read
  // tables.qrcode (column-level REVOKE), so the check goes through the SECURITY DEFINER
  // resolver — which returns nothing unless slug AND token match the same live table.
  const tableToken = typeof k === 'string' ? k : '';
  const { data: resolved } = await supabase.rpc('resolve_table_by_token', {
    p_project_slug: projectSlug,
    p_table_token: tableToken,
  });
  const tokenResolved = Boolean(resolved);

  // The UI must gate exactly when the server enforces, never earlier: while the rollout
  // window is open (REQUIRE_TABLE_TOKEN unset/false) already-printed QR sheets still work,
  // and every tokenless order is recorded so the flip can be justified with data.
  const orderingEnabled =
    tokenResolved || process.env.REQUIRE_TABLE_TOKEN !== 'true';

  // M5: cached + project-tagged — see getMenuData above.
  const { categories, products } = await getMenuData(project.id, table.id);

  return (
    <>
      {/* FIX-M-006: JSON-LD structured data (Restaurant) — خاصية jsonLd مدعومة
          في React 19 runtime لكن @types/react لا يعرّفها بعد — cast محلي فقط.
          بدون dangerouslySetInnerHTML: يبقى المشروع صفر استخدام له. */}
      <script
        type="application/ld+json"
        {...({
          jsonLd: {
            '@context': 'https://schema.org',
            '@type': 'Restaurant',
            name: project.name,
            url: `${getSiteUrl()}/${projectSlug}`,
            servesCuisine: 'Gulf',
          },
        } as object)}
      />
      <MenuClient
        project={project as Project}
        table={table as Table}
        tableToken={tableToken}
        orderingEnabled={orderingEnabled}
        categories={categories}
        products={products}
      />
    </>
  );
}
