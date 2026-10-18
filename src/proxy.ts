import { NextResponse, type NextRequest } from 'next/server';
import { updateSession } from '@/lib/supabase/middleware';
import { buildCsp, isNoncePath, siteIsHttps } from '@/lib/csp';

/**
 * Next.js 16 proxy (replaces middleware.ts).
 *
 * Two jobs:
 *  1. Refresh the Supabase session and apply the UX-level route gates
 *     (`updateSession`) — only on the routes that need it.
 *  2. Emit the Content-Security-Policy for every page, with a per-request nonce.
 *
 * The nonce must be on the REQUEST header: that is how Next learns to stamp
 * `nonce="…"` onto its own script tags during server rendering.
 *
 * It also keeps the table's scan token out of the render: a menu request carrying
 * `?k=` is rewritten for the SERVER with that parameter removed, so the RSC
 * payload can never contain it (the browser URL keeps it; the client reads it
 * from its own location). This replaces what `force-static` used to guarantee —
 * see the D3 note in src/app/[projectSlug]/menu/[tableSlug]/page.tsx.
 */

/** Routes whose cookies/session the SSR client refreshes. */
const SESSION_ROUTE_PREFIXES = [
  '/dashboard',
  '/onboarding',
  '/login',
  '/register',
  '/reset-password',
  '/api/pos',
] as const;

/** `/<store>/menu/<table>` — the customer menu (token lives in `?k=`). */
const MENU_PATH = /^\/[^/]+\/menu\/[^/]+\/?$/;

function needsSession(pathname: string): boolean {
  return SESSION_ROUTE_PREFIXES.some(
    (prefix) => pathname === prefix || pathname.startsWith(`${prefix}/`)
  );
}

/** 128 bits, base64 — the CSP nonce source token. */
function mintNonce(): string {
  const bytes = new Uint8Array(16);
  crypto.getRandomValues(bytes);
  return btoa(String.fromCharCode(...bytes));
}

export async function proxy(request: NextRequest) {
  const { pathname, searchParams } = request.nextUrl;
  const isApi = pathname.startsWith('/api');

  // D3: the table token must never reach the render. A QR link carries it as `?k=…`; the
  // server would echo it into the Flight payload's router state (Next builds that from the
  // request URL), so a document navigation is moved to the fragment, which browsers never
  // send upstream. Printed QRs keep working unchanged; the client reads `#k=`.
  if (
    MENU_PATH.test(pathname) &&
    searchParams.has('k') &&
    !request.headers.has('rsc') &&
    !searchParams.has('_rsc')
  ) {
    const token = searchParams.get('k') ?? '';
    const clean = request.nextUrl.clone();
    clean.searchParams.delete('k');
    clean.hash = `k=${encodeURIComponent(token)}`;
    return NextResponse.redirect(clean, 307);
  }

  // API responses are JSON — a CSP scope there is noise.
  const nonce = !isApi && isNoncePath(pathname) ? mintNonce() : null;
  const csp = nonce
    ? buildCsp({
        nonce,
        dev: process.env.NODE_ENV !== 'production',
        https: siteIsHttps(),
      })
    : null;

  if (nonce && csp) {
    request.headers.set('x-nonce', nonce);
    request.headers.set('Content-Security-Policy', csp);
  }

  let response;
  if (needsSession(pathname)) {
    response = await updateSession(request);
  } else {
    response = NextResponse.next({ request });
  }

  if (csp) response.headers.set('Content-Security-Policy', csp);

  return response;
}

export const config = {
  // Everything that can return HTML. Assets, the manifest and the generated
  // robots/sitemap files are excluded — they are not documents, and running the
  // proxy on them only adds edge work.
  matcher: [
    '/((?!_next/static|_next/image|favicon.ico|.*\\.(?:svg|png|jpg|jpeg|gif|webp|avif|ico|css|js|map|woff2?|ttf|otf|txt|xml|webmanifest)$).*)',
  ],
};
