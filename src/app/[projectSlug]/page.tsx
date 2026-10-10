import { unstable_cache } from 'next/cache';
import Link from 'next/link';
import Image from 'next/image';
import type { Metadata } from 'next';
import { getPublicProject } from '@/lib/public-project';
import { getSiteUrl } from '@/lib/site-url';
import { createAnonClient } from '@/lib/supabase/anon';
import { Unavailable } from '@/components/menu/unavailable';

export const dynamicParams = true;

/**
 * P1 (audit 2026-10-10) — the storefront root was the ONE public route with no cache wrapper.
 * Measured live: `x-vercel-cache: MISS` on every hit with TTFB 1.55-1.99s, while the sibling menu
 * route (whose reads go through unstable_cache) served from cache in 0.37s. Under the App Router a
 * route whose only data access is uncached renders per request, so every QR-scanning customer paid
 * a full server render for a page that changes when a merchant renames their store.
 *
 * Both reads now go through unstable_cache (60s), mirroring the menu route:
 *   * the tables read carries the SAME `menu-${projectId}` tag the dashboard's write path purges
 *     via /api/revalidate-menu, so adding or deactivating a table shows up immediately;
 *   * the project read is keyed by slug — its tag cannot be project-scoped (the id is what we are
 *     resolving), and the 60s window is enough for a name/logo/colour edit.
 */
const getCachedPublicProject = (slug: string) =>
  unstable_cache(() => getPublicProject(slug), ['storefront-project', slug], {
    revalidate: 60,
  })();

function getStorefrontTables(projectId: string) {
  return unstable_cache(
    async () => {
      const { data } = await createAnonClient()
        .from('tables')
        .select('id, number, slug')
        .eq('project_id', projectId)
        .eq('is_active', true)
        .order('number');
      return data ?? [];
    },
    ['storefront-tables', projectId],
    { revalidate: 60, tags: [`menu-${projectId}`] }
  )();
}

export const revalidate = 60;

/**
 * `force-static` is what actually makes the route cacheable — measured: with `unstable_cache` alone
 * `next build` still reported `ƒ /[projectSlug]` (Dynamic) and production answered
 * `x-vercel-cache: MISS`; the sibling menu route is `○` (Static) because it is force-static, and it
 * serves in 0.37s. Same page for every visitor (no cookies, no searchParams, token-free), so being
 * static is correct here.
 *
 * CONSEQUENCE, stated because it is a real trade-off: inside a forced-static route Next SWALLOWS
 * `notFound()`, so an unknown slug can no longer answer a hard 404 — it renders the graceful
 * `<Unavailable kind="store" />` page with a 200 instead (the mechanism measured on the menu route).
 * Unknown slugs are not linked from anywhere, so the SEO cost is nil, and a page with a real message
 * beats a blank 200. To get the hard 404 back, drop this line and accept `MISS` + ~1.9s TTFB.
 */
export const dynamic = 'force-static';

export async function generateMetadata({
  params,
}: {
  params: Promise<{ projectSlug: string }>;
}): Promise<Metadata> {
  const { projectSlug } = await params;
  const project = await getPublicProject(projectSlug);
  if (!project) return { title: 'المتجر غير متاح' };

  return {
    title: project.name,
    alternates: {
      canonical: `${getSiteUrl()}/${projectSlug}`,
    },
    openGraph: {
      title: project.name,
      description: `تصفح قائمة ${project.name}`,
    },
  };
}

export default async function StorefrontPage({
  params,
}: {
  params: Promise<{ projectSlug: string }>;
}) {
  const { projectSlug } = await params;

  const project = await getCachedPublicProject(projectSlug);
  // Rendered, not `notFound()` — swallowed inside a force-static route (see the note above).
  if (!project) return <Unavailable kind="store" />;

  const activeTables = await getStorefrontTables(project.id);

  // Owner decision 5 (2026-10-06): the old "1 active table → redirect straight to its menu"
  // shortcut is gone with the link list. /<slug> now ALWAYS states the rule ("scan the QR on
  // your table") and offers the single browse link, so the customer learns how ordering works
  // before they reach a menu they cannot order from.

  const heroColor = project.primary_color || '#7047EB';

  return (
    <main
      dir="rtl"
      className="flex min-h-dvh flex-col bg-[var(--color-bg)]"
    >
      {/* Hero */}
      <div
        className="flex flex-col items-center justify-center px-6 pb-16 pt-20 text-center"
        style={{ background: heroColor, color: '#fff' }}
      >
        {project.logo_url ? (
          <Image
            src={project.logo_url}
            alt={project.name}
            width={64}
            height={64}
            className="mb-4 h-16 w-16 rounded-full border-2 border-white/20 object-cover"
          />
        ) : (
          <div className="mb-4 flex h-16 w-16 items-center justify-center rounded-full bg-white/15 text-2xl font-bold">
            {project.name.charAt(0)}
          </div>
        )}
        <h1 className="text-2xl font-bold">{project.name}</h1>
        <p className="mt-2 text-sm text-white/70">قائمة طعام ومشروبات</p>

        <div className="mt-8">
          {activeTables.length > 0 ? (
            /* Owner decision 5 (2026-10-06, audit T2 #1): the table LINK LIST is gone. It
               published every active table slug to anyone who opened the store root, and the
               slug alone used to authorise an order. Ordering now requires scanning the QR on
               the physical table — this page says so, and offers ONE read-only browse link
               (which resolves to a token-less URL that the menu renders read-only). */
            <div className="flex flex-col items-center gap-4">
              <p className="max-w-xs text-sm font-semibold leading-6 text-white/85">
                امسح رمز QR الموجود على طاولتك للطلب
              </p>
              <Link
                href={`/${projectSlug}/menu/${activeTables[0].slug}`}
                className="inline-flex min-h-[44px] items-center justify-center rounded-xl bg-white/15 px-5 text-sm font-bold text-white backdrop-blur-sm transition-colors hover:bg-white/25 active:scale-95"
              >
                تصفّح القائمة
              </Link>
            </div>
          ) : (
            /* ── Zero tables: info + note ── */
            <div className="rounded-xl bg-white/10 px-6 py-4 backdrop-blur-sm">
              <p className="text-sm font-semibold text-white">
                مرحباً بك في {project.name}
              </p>
              <p className="mt-1 text-xs text-white/70">
                القائمة غير متاحة حالياً — اسأل الكاشير للمساعدة
              </p>
            </div>
          )}
        </div>
      </div>

      {/* Footer */}
      <div className="mt-auto pb-8 pt-6 text-center">
        <p className="text-[11.5px] text-[var(--color-text-tertiary)]" dir="ltr">
          Powered by Dokan
        </p>
      </div>
    </main>
  );
}