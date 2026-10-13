import { NextRequest, NextResponse } from 'next/server';
import * as Sentry from '@sentry/nextjs';
import type { SupabaseClient } from '@supabase/supabase-js';
import { createClient } from '@/lib/supabase/server';
import { createAdminClient } from '@/lib/supabase/admin';
import { limitSuperAdmin } from '@/lib/super-admin-rate-limit';
import type { Database } from '@/lib/database.types';

/**
 * The shared gate for every `/api/super-admin/*` route.
 *
 * WHY THIS EXISTS (architecture review 2026-10-13, finding P1): all eight routes
 * opened with the same ~28 lines — `getUser()`, an `is_super_admin()` RPC, the
 * throttle, and a `catch` that reports to Sentry — and each copy was subtly its
 * own: the throttle key, the spelling of the 401/403 bodies, whether a request
 * with no body produced a 500. `is_super_admin()` was called from eleven places.
 * The gate is now written once, and a route author writes only the part that is
 * actually about their action.
 *
 * The ORDER inside is load-bearing and must not be "tidied":
 *   1. authenticate  → 401 when there is no session
 *   2. authorise     → 403 for a signed-in non-admin
 *   3. throttle      → keyed on the admin's own user id (see super-admin-rate-limit)
 *   4. run the action
 * Authentication precedes input validation so an unauthenticated caller cannot
 * learn the request shape from a 400 that arrives ahead of the 401. Everything,
 * including a throwing `getUser()`, is inside the try so it lands in one place.
 */

/** What every super-admin action receives. */
export type AdminContext = {
  /** The authenticated admin's user id — pass it as `p_caller_user_id`. */
  userId: string;
  /** Service-role client (bypasses RLS). Never hand this to the browser. */
  admin: SupabaseClient<Database>;
  /** The admin's OWN session-scoped client — the only way to read their session. */
  client: SupabaseClient<Database>;
};

export type AdminHandler = (
  request: NextRequest,
  ctx: AdminContext
) => Promise<NextResponse>;

export type AdminHandlerOptions = {
  /**
   * Map a thrown error to a response of its own (e.g. the impersonation route
   * turns an MFA target into a 409). Return null to fall through to the shared
   * 500 handler.
   */
  onError?: (err: unknown) => NextResponse | null;
};

/**
 * Wrap a super-admin action with the authentication, authorisation, throttling
 * and error-reporting contract.
 *
 * @param action  throttle bucket suffix — keep it stable per route, it is part
 *                of the rate-limit key (`sa:<userId>:<action>`).
 */
export function withSuperAdmin(
  action: string,
  handler: AdminHandler,
  options: AdminHandlerOptions = {}
) {
  return async function POST(request: NextRequest): Promise<NextResponse> {
    try {
      const client = await createClient();
      const {
        data: { user },
      } = await client.auth.getUser();
      if (!user) return NextResponse.json({ error: 'غير مصرح' }, { status: 401 });

      const { data: isAdmin } = await client.rpc('is_super_admin');
      if (!isAdmin) return NextResponse.json({ error: 'غير مصرح' }, { status: 403 });

      const throttled = await limitSuperAdmin(request, user.id, action);
      if (throttled) return throttled;

      return await handler(request, { userId: user.id, admin: createAdminClient(), client });
    } catch (err) {
      const mapped = options.onError?.(err);
      if (mapped) {
        // A route-owned mapping may still want the error reported (the JWT
        // misconfiguration is a real alert; the MFA refusal is not). It decides.
        return mapped;
      }
      Sentry.captureException(err);
      return NextResponse.json({ error: 'خطأ في الخادم' }, { status: 500 });
    }
  };
}

/** `{ok:true, body}` — or the 400 to return as-is. */
export type JsonBody =
  | { ok: true; body: Record<string, unknown> }
  | { ok: false; response: NextResponse };

/**
 * Read a JSON object body, turning the two ways `request.json()` betrays a
 * caller (not JSON at all, or JSON that is not an object) into one 400 instead
 * of an uncaught throw → 500 + Sentry noise for input nobody validated.
 */
export async function readJsonBody(
  request: NextRequest,
  message = 'بيانات غير صالحة'
): Promise<JsonBody> {
  const raw = await request.json().catch(() => null);
  if (raw === null || typeof raw !== 'object' || Array.isArray(raw)) {
    return { ok: false, response: NextResponse.json({ error: message }, { status: 400 }) };
  }
  return { ok: true, body: raw as Record<string, unknown> };
}

const UUID_RE = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;

/** Is this a UUID? Guards the id-shaped params and body fields these routes take. */
export function isUuid(value: unknown): value is string {
  return typeof value === 'string' && UUID_RE.test(value);
}
