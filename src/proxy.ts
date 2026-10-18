import { NextResponse, type NextRequest } from 'next/server';
import { updateSession } from '@/lib/supabase/middleware';
import { buildCsp, isNonceRoute, siteIsHttps } from '@/lib/csp';

/**
 * Next.js 16 proxy (replaces middleware.ts).
 *
 * Two jobs:
 *  1. Refresh the Supabase session and apply the UX-level route gates
 *     (`updateSession`) — only on the routes that need it.
 *  2. Emit the Content-Security-Policy for every page. Dynamic routes
 *     (`/dashboard/*`, `/super-admin/*`) are rendered per request, so they get a
 *     freshly minted nonce; prerendered/ISR routes get the static policy. See
 *     `src/lib/csp.ts` for why the two cannot be one policy.
 *
 * The nonce must be on the REQUEST header: that is how Next learns to stamp
 * `nonce="…"` onto its own script tags during server rendering.
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
  const { pathname } = request.nextUrl;
  const isApi = pathname.startsWith('/api');

  // API responses are JSON — a CSP scope there is noise.
  const nonce = !isApi && isNonceRoute(pathname) ? mintNonce() : undefined;
  const csp = isApi
    ? null
    : buildCsp({
        nonce,
        dev: process.env.NODE_ENV !== 'production',
        https: siteIsHttps(),
      });

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
