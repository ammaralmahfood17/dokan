import { NextResponse } from 'next/server';
import * as Sentry from '@sentry/nextjs';
import { createAdminClient } from '@/lib/supabase/admin';
import { rateLimit, createRateLimitResponse } from '@/lib/rate-limit';
import { getClientIp } from '@/lib/ip';

/**
 * Server-side signup endpoint.
 * 
 * BEST PRACTICE (chosen architecture):
 * - Signup ONLY creates the auth user (via service role for reliability).
 * - No auto-creation of project/store here.
 * - The user is immediately sent to /onboarding where they explicitly create
 *   their first project (name, slug, currency, theme).
 * 
 * Why this is the best option:
 * - Matches the actual product onboarding UX.
 * - Avoids ugly auto-generated slugs.
 * - Separates auth identity from business entity creation.
 * - Avoids schema conflicts (old trigger was trying to create legacy 'profiles'/'stores').
 * - Easier to evolve onboarding in the future.
 */

export async function POST(request: Request) {
  try {
    const body = await request.json();
    // A literal `null` body is valid JSON, so request.json() returns null and
    // the destructure below would throw a TypeError -> a 500 on an
    // unauthenticated caller. Non-object input is a 400 like any other bad
    // signup payload.
    if (body === null || typeof body !== 'object' || Array.isArray(body)) {
      return NextResponse.json({ error: 'بيانات غير صالحة' }, { status: 400 });
    }
    const { email, password, fullName } = body;

    if (!email || !password) {
      return NextResponse.json({ 
        error: 'البريد الإلكتروني وكلمة المرور مطلوبان' 
      }, { status: 400 });
    }

    // UX-report C4: admin.auth.admin.createUser BYPASSES GoTrue validation —
    // without this, direct API calls could mint 1-char passwords. Mirrors the
    // client rule (register/page.tsx: >=6) + bcrypt-safe 72 cap used by login.
    if (typeof password !== 'string' || password.length < 6 || password.length > 72) {
      return NextResponse.json({ error: 'كلمة المرور يجب أن تكون 6-72 حرفًا' }, { status: 400 });
    }
    if (typeof email !== 'string' || !/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(email)) {
      return NextResponse.json({ error: 'بريد إلكتروني غير صالح' }, { status: 400 });
    }

    // Rate limit: 3 signups per email per minute
    const rateKey = `signup:${email.trim().toLowerCase()}`;
    const limitResult = await rateLimit(rateKey, { limit: 3, windowMs: 60 * 1000, keyPrefix: 'auth-signup' });
    if (!limitResult.allowed) {
      const res = createRateLimitResponse(limitResult.resetIn);
      return NextResponse.json({ error: res.error }, { status: res.status });
    }

    // IP cap too — mass account creation across many emails from one IP
    // (spam / email bombing) bypasses the per-email limit entirely.
    const ip = getClientIp(request);
    const ipLimit = await rateLimit(`signup-ip:${ip}`, {
      limit: 10,
      windowMs: 60 * 60 * 1000,
      keyPrefix: 'auth-signup-ip',
    });
    if (!ipLimit.allowed) {
      const res = createRateLimitResponse(ipLimit.resetIn);
      return NextResponse.json({ error: res.error }, { status: res.status });
    }

    const admin = createAdminClient();

    // Create user using admin client (reliable, works with email_confirm disabled)
    const { data: createData, error: createError } = await admin.auth.admin.createUser({
      email: email.trim().toLowerCase(),
      password: String(password),
      email_confirm: true, // confirmation is disabled in this project
      user_metadata: {
        full_name: String(fullName?.trim?.() || ''),
        from_api: 'true',       // safety trigger skips users from the main API
      },
    });

    if (createError) {
      // Don't leak internal error details / user-enumeration signals to clients.
      console.error('[API /auth/signup] createUser error:', createError.message);
      Sentry.captureException(createError);
      return NextResponse.json({
        error: 'تعذر إنشاء الحساب، يرجى المحاولة مرة أخرى',
      }, { status: 400 });
    }

    const userId = createData.user?.id;

    if (!userId) {
      return NextResponse.json({ 
        error: 'لم يتم إنشاء المستخدم بشكل صحيح' 
      }, { status: 500 });
    }

    return NextResponse.json({
      success: true,
      user: {
        id: userId,
        email: createData.user?.email,
      },
      message: 'تم إنشاء الحساب بنجاح',
    });
  } catch (err: unknown) {
    console.error(
      '[API /auth/signup] unexpected error:',
      err instanceof Error ? err.message : 'unknown error'
    );
    Sentry.captureException(err);
    return NextResponse.json({
      error: 'خطأ داخلي في الخادم',
    }, { status: 500 });
  }
}
