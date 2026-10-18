import { unstable_cache } from 'next/cache';
import type { Metadata } from 'next';
import { createAnonClient } from '@/lib/supabase/anon';
import { getSiteUrl } from '@/lib/site-url';
import { getPublicProject } from '@/lib/public-project';
import { MenuClient } from './menu-client';
import { Unavailable } from '@/components/menu/unavailable';
import type { Category, Product, ProductOptionGroup, Project, Table } from '@/lib/types';
import { buildRestaurantJsonLd, serializeJsonLd } from '@/lib/jsonld';
import { isTableTokenRequired } from '@/lib/public-write-guard';

// The page renders per request (F-18): the root layout is `force-dynamic`, and a nested
// `force-static` makes Next throw "Dynamic server usage" on every request. Data reads below are
// `unstable_cache`, project-tagged, purged on edit, so the database is not hit per scan.

// M5: on-demand invalidation. Product/category edits call
// /api/revalidate-menu, which revalidateTag()s `menu-${projectId}`. The menu
// queries below are cached under that project-scoped tag, so an edit shows on
// the live QR menu immediately instead of waiting up to 60s (or longer with
// SWR). Wrapped in a function so the tag can be project-scoped (unstable_cache
// options are evaluated per call).
/**
 * F-5: does this table exist? generateMetadata needs the answer to decide between "a real menu"
 * and "a slug nobody printed", and the page body already resolves it — but the body cannot tell
 * metadata anything. Cached under the menu tag so an added/deactivated table shows up at once.
 */
/**
 * The project read used to be the only uncached query on this page — one PostgREST round trip
 * (~150 ms floor, see references/perf-round-trip-floor.md) on every QR scan. Cached by slug,
 * same 60 s window as the menu data it gates.
 */
function getCachedProject(slug: string) {
  return unstable_cache(() => getPublicProject(slug), ['menu-project', slug], {
    revalidate: 60,
  })();
}

async function getMenuTable(projectId: string, tableSlug: string) {
  return unstable_cache(
    async () => {
      const { data } = await createAnonClient()
        .from('tables')
        .select('id, number, slug, is_active, project_id')
        .eq('project_id', projectId)
        .eq('slug', tableSlug)
        .eq('is_active', true)
        .maybeSingle();
      return data;
    },
    ['menu-table', projectId, tableSlug],
    { revalidate: 60, tags: [`menu-${projectId}`] }
  )();
}

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

// D3 (owner decision 2026-10-06): the rendered HTML must not depend on the table token. The route
// never reads `searchParams`; the token is read by the CLIENT from its own URL and enforced
// server-side by /api/public/order, which is the security boundary. Data reads stay cached
// (`unstable_cache` + the `menu-${projectId}` tag), so edits still show up immediately.
//
// F-18 (2026-10-18): this route renders per request, like every other page, so the CSP can carry
// a nonce. `force-static` is NOT possible while the root layout is `force-dynamic` — Next throws
// "Dynamic server usage" on every request (measured: the menu 500'd on production). The cost is
// measured and accepted: see docs/audit-2026-10/REMEDIATION.md F-18. The token stays out of the
// render because the client reads it from its own URL and the server never sees it as state;
// /api/public/order enforces it.

// A2/UX-report: every public menu served under 3 hostnames had no canonical —
// search engines saw duplicates. Store name also becomes the tab/OG title.
export async function generateMetadata({
  params,
}: {
  params: Promise<{ projectSlug: string; tableSlug: string }>;
}): Promise<Metadata> {
  const { projectSlug, tableSlug } = await params;
  const project = await getPublicProject(projectSlug);
  if (!project) {
    return { title: 'القائمة', robots: { index: false, follow: false } };
  }

  const table = await getMenuTable(project.id, tableSlug);
  const title = `${project.name} — القائمة`;
  // F-5: an unknown table slug answered 200 with a SELF-referential canonical and no noindex —
  // a textbook soft-404 that Google may index as a menu that does not exist. The response stays
  // 200 (a page with a real message beats a blank shell), so the SEO half is closed here:
  // noindex + canonical pointing at the STORE.
  if (!table) {
    return {
      title,
      robots: { index: false, follow: true },
      alternates: { canonical: `${getSiteUrl()}/${projectSlug}` },
    };
  }

  const url = `${getSiteUrl()}/${projectSlug}/menu/${tableSlug}`;
  return {
    title,
    alternates: { canonical: url },
    // F-14: this page inherited the homepage's og:url/og:title, so sharing a menu link showed
    // the platform's card instead of the store's.
    openGraph: {
      title,
      description: `قائمة ${project.name} — امسح رمز الطاولة للطلب`,
      url,
      ...(project.logo_url ? { images: [{ url: project.logo_url, alt: project.name }] } : {}),
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

  const project = await getCachedProject(projectSlug);
  // Rendered, not `notFound()`: the designed "unavailable" state is more useful than the generic
  // 404. See src/components/menu/unavailable.tsx.
  if (!project) return <Unavailable kind="store" />;

  // Resolve active table inside project
  const { data: table } = await supabase
    .from('tables')
    .select('id, number, slug, is_active, project_id')
    .eq('project_id', project.id)
    .eq('slug', tableSlug)
    .eq('is_active', true)
    .maybeSingle();

  if (!table) return <Unavailable kind="table" />;

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
