import { NextResponse } from 'next/server';
import { createClient } from '@/lib/supabase/server';
import { rateLimit, createRateLimitResponse } from '@/lib/rate-limit';
import { getSiteUrl } from '@/lib/site-url';

/**
 * POST /api/auth/reset-password
 * Sends a password reset email to the user.
 * Rate limited to prevent abuse.
 */
export async function POST(request: Request) {
  try {
    const body = (await request.json().catch(() => null)) as { email?: string };
    if (body === null || typeof body !== 'object' || Array.isArray(body)) {
      return NextResponse.json({ error: 'بيانات غير صالحة' }, { status: 400 });
    }
    // A literal `null` body is valid JSON, so request.json() returns null and
    // `body.email` would throw a TypeError -> a 500 on an anonymous caller.
    // The message stays deliberately vague for every malformed shape so this
    // endpoint cannot be used to probe which inputs are valid.
    if (body === null || typeof body !== 'object' || Array.isArray(body)) {
      return NextResponse.json({ error: 'البريد الإلكتروني مطلوب' }, { status: 400 });
    }
    const email = body.email?.trim().toLowerCase();

    if (!email) {
      return NextResponse.json({ error: 'البريد الإلكتروني مطلوب' }, { status: 400 });
    }

    // Rate limit: 2 requests per email per 5 minutes
    const limitResult = await rateLimit(`reset:${email}`, {
      limit: 2,
      windowMs: 5 * 60 * 1000,
      keyPrefix: 'auth-reset',
    });

    if (!limitResult.allowed) {
      const res = createRateLimitResponse(limitResult.resetIn);
      return NextResponse.json({ error: res.error }, { status: res.status });
    }

    const supabase = await createClient();
    // NEVER trust the Origin header for a security-critical email link — an
    // attacker controls it and could harvest the recovery code. Use the
    // configured deployment origin (NEXT_PUBLIC_SITE_URL) instead.
    //
    // IMPORTANT: redirect straight to /update-password, NOT /auth/callback.
    // The verify 303 lands with the session in the URL FRAGMENT
    // (#access_token=...) — fragments never reach the server, so a server
    // callback route would drop the token and bounce to /login. The browser
    // client (createBrowserClient) parses the fragment on load, which is
    // exactly what /update-password does.
    const { error } = await supabase.auth.resetPasswordForEmail(email, {
      redirectTo: `${getSiteUrl()}/update-password`,
    });

    if (error) {
      console.error('[Reset Password]', error);
      // Don't reveal if email exists or not (security)
      return NextResponse.json({ success: true });
    }

    return NextResponse.json({ success: true });
  } catch (err) {
    console.error('Reset password API error:', err);
    return NextResponse.json({ error: 'خطأ داخلي' }, { status: 500 });
  }
}
