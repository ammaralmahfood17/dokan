import { NextResponse } from 'next/server';
import * as Sentry from '@sentry/nextjs';
import { createAdminClient } from '@/lib/supabase/admin';
import { rateLimit, createRateLimitResponse } from '@/lib/rate-limit';
import { getClientIp } from '@/lib/ip';
import { validateNewPassword } from '@/lib/password-policy';
import { createAnonClient } from '@/lib/supabase/anon';
import { turnstileErrorMessage, verifyTurnstile } from '@/lib/turnstile';

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
    const body = await request.json().catch(() => null);
    if (body === null || typeof body !== 'object' || Array.isArray(body)) {
      return NextResponse.json({ error: 'بيانات غير صالحة' }, { status: 400 });
    }
    // A literal `null` body is valid JSON, so request.json() returns null and
    // the destructure below would throw a TypeError -> a 500 on an
    // unauthenticated caller. Non-object input is a 400 like any other bad
    // signup payload.
    if (body === null || typeof body !== 'object' || Array.isArray(body)) {
      return NextResponse.json({ error: 'بيانات غير صالحة' }, { status: 400 });
    }
    const { email, password, fullName, turnstileToken } = body;

    if (!email || !password) {
      return NextResponse.json({ 
        error: 'البريد الإلكتروني وكلمة المرور مطلوبان' 
      }, { status: 400 });
    }

    // Audit T2 #2: admin.auth.admin.createUser BYPASSES GoTrue validation entirely, so this
    // check IS the password policy on this path (config.toml + the hosted Auth setting apply
    // only to GoTrue's own endpoints). Shared with the forms via src/lib/password-policy.ts.
    const pw = validateNewPassword(password);
    if (!pw.ok) {
      return NextResponse.json({ error: pw.error }, { status: 400 });
    }
    if (typeof fullName !== 'string' || fullName.trim().length < 2 || fullName.length > 80) {
      return NextResponse.json({ error: 'الاسم مطلوب (حرفان على الأقل)' }, { status: 400 });
    }
    if (typeof email !== 'string' || !/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(email)) {
      return NextResponse.json({ error: 'بريد إلكتروني غير صالح' }, { status: 400 });
    }

    const ip = getClientIp(request);

    // Owner decisions 7 + 8: the CAPTCHA is verified BEFORE the rate limits, so a bot farm
    // cannot spend a real merchant's per-IP budget. An unconfigured Turnstile in production
    // is a REFUSAL (503), never a bypass — the boot-time validator refuses to start such a
    // deployment too, so a missing secret cannot go unnoticed.
    // Deliberate pause (owner decision 2026-10-06): signups are closed until Turnstile keys exist,
    // and they stay closed even if keys appear later - the switch is explicit, not implicit.
    if (process.env.SIGNUP_ENABLED === 'false') {
      return NextResponse.json({ error: 'التسجيل متوقف مؤقتًا، جرّب لاحقًا.' }, { status: 503 });
    }

    const turnstile = await verifyTurnstile(turnstileToken, ip);
    if (!turnstile.ok) {
      return NextResponse.json(
        { error: turnstileErrorMessage(turnstile.reason) },
        { status: turnstile.reason === 'not-configured' ? 503 : 400 }
      );
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
      email_confirm: false,
      // Owner decision 7: confirmations are ON, so the account starts UNCONFIRMED and the
      // merchant proves the inbox before it can be used.
      user_metadata: {
        full_name: fullName.trim(),
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

    // admin.createUser does NOT send mail, so the confirmation is triggered explicitly with
    // the anon client (the endpoint GoTrue exposes for exactly this). If it fails, the account
    // exists but is unreachable — report that honestly instead of a cheerful "check your inbox".
    const { error: sendError } = await createAnonClient().auth.resend({
      type: 'signup',
      email: email.trim().toLowerCase(),
    });
    if (sendError) Sentry.captureException(sendError);

    return NextResponse.json({
      success: true,
      needsConfirmation: true,
      emailSent: !sendError,
      user: {
        id: userId,
        email: createData.user?.email,
      },
      message: sendError
        ? 'تم إنشاء الحساب، لكن تعذّر إرسال رسالة التأكيد. جرّب تسجيل الدخول ثم «نسيت كلمة المرور».'
        : 'تم إنشاء الحساب. تحقق من بريدك الإلكتروني لتأكيده ثم سجّل الدخول.',
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
