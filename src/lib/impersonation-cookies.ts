/**
 * Support-mode auth-cookie plumbing.
 *
 * The impersonation start route swaps the browser's Supabase session by writing the SSR auth
 * cookie itself. It cannot hand the session to page JS (`setSession` in the client) because the
 * hardening contract is that tokens never transit the response body — and it must cap the cookie
 * at the 15-minute support window, which the SDK's own storage would not do (auth-js derives
 * `maxAge` from the JWT, up to an hour).
 *
 * That leaves exactly one thing to get right: the bytes must match what `@supabase/ssr` reads.
 *   - name: `sb-<project-ref>-auth-token`, chunks as `<name>.0`, `<name>.1`, …
 *   - value: `base64-` + base64url(JSON.stringify(session))
 *   - a session over 3180 chars is chunked by the SDK; browsers silently drop a single cookie
 *     over ~4096 bytes, which used to be an invisible "API 200 but the browser never logged in".
 *
 * `combineChunks` in @supabase/ssr returns the un-suffixed cookie when present and only then
 * joins the chunks, so a stale base cookie wins over fresh chunks. Every write therefore expires
 * all slots first, then sets the ones it needs.
 */

/** Mirrors @supabase/ssr's MAX_CHUNK_SIZE. */
export const AUTH_COOKIE_CHUNK_SIZE = 3180;

/** @supabase/ssr looks up at most five chunk hints per key. */
export const MAX_AUTH_COOKIE_CHUNKS = 5;

export type CookieJar = {
  cookies: {
    set(
      name: string,
      value: string,
      options: {
        path: string;
        maxAge: number;
        sameSite?: 'lax';
        secure?: boolean;
        httpOnly?: boolean;
      }
    ): unknown;
  };
};

/** Supabase project ref — the first label of the project hostname (`<ref>.supabase.co`). */
export function supabaseProjectRef(supabaseUrl: string): string {
  return new URL(supabaseUrl).hostname.split('.')[0];
}

/** The base cookie name followed by every chunk name the SDK may read. */
export function authCookieNames(supabaseUrl: string): string[] {
  const base = `sb-${supabaseProjectRef(supabaseUrl)}-auth-token`;
  return [base, ...Array.from({ length: MAX_AUTH_COOKIE_CHUNKS }, (_, i) => `${base}.${i}`)];
}

export function encodeAuthCookie(session: unknown): string {
  return `base64-${Buffer.from(JSON.stringify(session)).toString('base64url')}`;
}

function cookieOptions(maxAge: number) {
  return {
    path: '/',
    sameSite: 'lax' as const,
    // The auth cookie is intentionally readable by the browser client; the marker cookie is the
    // httpOnly one. `secure` must match how @supabase/ssr writes it so a single browser does not
    // end up holding two flavours of the same cookie.
    secure: process.env.NODE_ENV === 'production',
    maxAge,
  };
}

/**
 * Write `session` as the SSR auth cookie, chunked exactly as the SDK would chunk it, capped at
 * `maxAgeSeconds` (the support window — never the JWT's own lifetime).
 */
export function writeAuthCookie(
  response: CookieJar,
  supabaseUrl: string,
  session: unknown,
  maxAgeSeconds: number
): void {
  const [base] = authCookieNames(supabaseUrl);
  const encoded = encodeAuthCookie(session);
  const chunkCount = Math.ceil(encoded.length / AUTH_COOKIE_CHUNK_SIZE);
  if (chunkCount > MAX_AUTH_COOKIE_CHUNKS) {
    // Refuse loudly. Writing it anyway is the silent failure this module exists to prevent.
    throw new Error('impersonation session is too large to store in cookies');
  }

  // Expire every slot first — see the header note about a stale base beating fresh chunks.
  for (const name of authCookieNames(supabaseUrl)) {
    response.cookies.set(name, '', cookieOptions(0));
  }

  if (chunkCount <= 1) {
    response.cookies.set(base, encoded, cookieOptions(maxAgeSeconds));
    return;
  }
  for (let i = 0; i < chunkCount; i += 1) {
    response.cookies.set(
      `${base}.${i}`,
      encoded.slice(i * AUTH_COOKIE_CHUNK_SIZE, (i + 1) * AUTH_COOKIE_CHUNK_SIZE),
      cookieOptions(maxAgeSeconds)
    );
  }
}

/** Remove the session cookie and every chunk — used whenever support mode cannot be restored. */
export function clearAuthCookies(response: CookieJar, supabaseUrl: string): void {
  for (const name of authCookieNames(supabaseUrl)) {
    response.cookies.set(name, '', cookieOptions(0));
  }
}
