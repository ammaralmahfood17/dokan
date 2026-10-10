import { notFound } from 'next/navigation';
import { unstable_cache } from 'next/cache';
import type { Metadata } from 'next';
import { createAnonClient } from '@/lib/supabase/anon';
import { getSiteUrl } from '@/lib/site-url';
import { getPublicProject } from '@/lib/public-project';
import { MenuClient } from './menu-client';
import type { Category, Product, ProductOptionGroup, Project, Table } from '@/lib/types';
import { buildRestaurantJsonLd, serializeJsonLd } from '@/lib/jsonld';
import { isTableTokenRequired } from '@/lib/public-write-guard';

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
          .select('*, option_groups(*, option_choices(*))')
          .eq('project_id', projectId)
          .order('is_available', { ascending: false })
          .order('sort_order'),
      ]);
      return {
        categories: (categories ?? []) as Category[],
        products: (products ?? []) as (Product & { option_groups: ProductOptionGroup[] })[],
      };
    },
    ['menu-data', projectId, tableId],
    { revalidate: 60, tags: [`menu-${projectId}`] }
  )();
}

// Owner decision D3 (2026-10-06): the public menu is CACHED again. The route no longer reads
// `searchParams`, so the rendered HTML is identical for every visitor and carries no table token:
//   * the token lives in the URL fragment the QR encodes and is read by the CLIENT,
//   * /api/public/order still resolves and enforces it server-side (that is the security boundary),
//   * the only server knob the HTML depends on is REQUIRE_TABLE_TOKEN, an env constant identical
//     for every request, which is what makes this cacheable at all.
// On-demand revalidation is unchanged: getMenuData tags its fetches `menu-${projectId}` and the menu
// write path calls /api/revalidate-menu (revalidateTag). See src/lib/products-utils.ts.
export const revalidate = 60;
// The FIRST measurement of D3 failed and this line is why it is here. With the route merely
// "dynamic", Next still builds its router state tree from the REQUEST url, so a request carrying the
// token produced `"c":["","estikana","menu","table-1?k=<token>"]` inside the React Flight payload -
// the served HTML was not identical with and without `?k=` AND the token was in the page source.
// `force-static` tells Next the render must not depend on the request at all: the response is then
// produced once per path and reused, the router state carries no query, and the client still reads
// the token from its own browser URL (which the server never sees). Verified by
// e2e/menu-cache.a11y.spec.ts; measured before this line with the token visible in the payload.
export const dynamic = 'force-static';

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
}: {
  params: Promise<{ projectSlug: string; tableSlug: string }>;
}) {
  const { projectSlug, tableSlug } = await params;
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

  // D3: the token is NOT resolved here any more - resolving it would make the render depend on the
  // request. The client reads it from the URL and the order endpoint enforces it. What the page
  // passes down is only the rollout flag, which is constant for every visitor:
  const requireToken = isTableTokenRequired();

  // M5: cached + project-tagged — see getMenuData above.
  const { categories, products } = await getMenuData(project.id, table.id);

  return (
    <>
      {/* audit T1 #5: a real JSON-LD body. The old `jsonLd` PROP is not a React DOM API - React 19
          renders it as the attribute jsonLd="[object Object]" (its own warning, captured by
          src/lib/jsonld.test.ts: "React does not recognize the `jsonLd` prop on a DOM element"), so
          the page carried no structured data at all. This is the ONE legitimate
          dangerouslySetInnerHTML in this codebase: the payload is JSON.stringify'd from server-side
          values, never user HTML. Do not add a second one. */}
      <script
        type="application/ld+json"
        dangerouslySetInnerHTML={{
          __html: serializeJsonLd(
            buildRestaurantJsonLd({
              name: project.name,
              url: `${getSiteUrl()}/${projectSlug}`,
              image: project.logo_url,
            })
          ),
        }}
      />
      <MenuClient
        project={project as Project}
        table={table as Table}
        requireToken={requireToken}
        categories={categories}
        products={products}
      />
    </>
  );
}
