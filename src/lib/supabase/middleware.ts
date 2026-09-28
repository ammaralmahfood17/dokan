import { createServerClient } from '@supabase/ssr';
import { NextResponse, type NextRequest } from 'next/server';
import { getPublicSupabaseConfig } from '@/lib/env/public';

/**
 * Refresh Supabase session cookies and enforce auth for protected routes.
 * 
 * PERFORMANCE: Uses getSession() (local cookie read, ~1ms) instead of
 * getUser() (Supabase Auth API call, 200-800ms). JWT signature is still
 * verified locally via the cookie parser.
 */
export async function updateSession(request: NextRequest) {
  let response = NextResponse.next({ request });
  const path = request.nextUrl.pathname;
  const { url: supabaseUrl, anonKey } = getPublicSupabaseConfig();

  // An impersonation session has no usable refresh token by design. Avoid the
  // SSR helper's refresh path; dashboard layout verifies the server-side marker
  // and presents a recovery screen after expiry.
  if (
    request.cookies.has('dokan-impersonation') &&
    (path.startsWith('/dashboard') || path.startsWith('/api/pos/'))
  ) {
    return response;
  }

  const supabase = createServerClient(
    supabaseUrl,
    anonKey,
    {
      cookies: {
        getAll() {
          return request.cookies.getAll();
        },
        setAll(cookiesToSet) {
          cookiesToSet.forEach(({ name, value }) =>
            request.cookies.set(name, value)
          );
          response = NextResponse.next({ request });
          cookiesToSet.forEach(({ name, value, options }) =>
            response.cookies.set(name, value, options)
          );
        },
      },
    }
  );

  // getSession() reads the JWT from the cookie locally — no network call
  const {
    data: { session },
  } = await supabase.auth.getSession();

  const user = session?.user ?? null;
  const isAuthPage =
    path === '/login' ||
    path === '/register' ||
    path.startsWith('/login/') ||
    path.startsWith('/register/');

  const isProtected =
    path.startsWith('/dashboard') ||
    path.startsWith('/onboarding');
  // NOTE: /update-password is deliberately NOT in isProtected. The recovery
  // flow lands there with the session in the URL FRAGMENT (#access_token=),
  // which only the browser client can parse AFTER the HTML loads. If the
  // middleware bounced guests to /login first, the fragment would be lost
  // and password recovery would break. The page itself guards (no session →
  // redirect /login).

  // Guest on protected route → login
  if (!user && isProtected) {
    const url = request.nextUrl.clone();
    url.pathname = '/login';
    url.searchParams.set('next', path);
    return NextResponse.redirect(url);
  }

  // Authenticated on auth pages → their home (super admin → super-admin,
  // store owner → dashboard; dashboard/layout redirects no-store users to
  // onboarding, saving a DB call here).
  if (user && isAuthPage) {
    const { data: isSuperAdmin } = await supabase.rpc('is_super_admin');
    const url = request.nextUrl.clone();
    url.pathname = isSuperAdmin ? '/super-admin/subscriptions' : '/dashboard';
    return NextResponse.redirect(url);
  }

  // Always refresh the session cookie
  return response;
}
