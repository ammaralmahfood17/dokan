import { NextResponse, type NextRequest } from 'next/server';
import { updateSession } from '@/lib/supabase/middleware';
import { buildCsp, siteIsHttps } from '@/lib/csp';

/**
 * Next.js 16 proxy (replaces middleware.ts).
 *
 * Two jobs:
 *  1. Refresh the Supabase session and apply the UX-level route gates
 *     (`updateSession`) — only on the routes that need it.
 *  2. Emit the Content-Security-Policy. Every page renders per request and gets a
 *     fresh nonce.
 *
 * The nonce must be on the REQUEST header: that is how Next learns to stamp
 * `nonce="…"` onto its own script tags during server rendering.
 *
 * The table's scan token is not handled here: new QR links carry it in the
 * fragment (`#k=`) and old sheets' `?k=` never reaches the render because the
 * menu route is `force-static` (it ignores the query). The client reads both.
 */

/** `/<store>/menu/<table>` — the customer menu (a QR link carries the token as `?k=`). */
const MENU_PATH = /^\/[^/]+\/menu\/[^/]+\/?$/;

/** Routes whose cookies/session the SSR client refreshes. */
const SESSION_ROUTE_PREFIXES = [
  '/dashboard',
  '/onboarding',
  '/login',
  '/register',
  '/reset-password',
  '/api/pos',
] as const;

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

  // D3: the token must not reach the render. A QR link carries it as `?k=`; because the page
  // renders per request, Next would echo that into the Flight payload's router state. Move a
  // document navigation to the fragment, which browsers never send upstream. New QR links are
  // already printed with `#k=` (menuPath), so only older sheets pay this redirect.
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
  const env = { dev: process.env.NODE_ENV !== 'production', https: siteIsHttps() };

  // API responses are JSON — a CSP scope there is noise.
  const nonce = !isApi ? mintNonce() : null;
  const csp = nonce ? buildCsp({ nonce, ...env }) : null;

  if (nonce && csp) {
    request.headers.set('x-nonce', nonce);
    request.headers.set('Content-Security-Policy', csp);
  }

  const response = needsSession(pathname)
    ? await updateSession(request)
    : NextResponse.next({ request });

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
