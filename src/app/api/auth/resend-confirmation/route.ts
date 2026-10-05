import { NextResponse } from 'next/server';
import * as Sentry from '@sentry/nextjs';
import { createAnonClient } from '@/lib/supabase/anon';
import { rateLimit, createRateLimitResponse } from '@/lib/rate-limit';
import { getClientIp } from '@/lib/ip';

/**
 * Resend the signup confirmation mail — 2026-10 audit remediation, amendment A5
 * (owner decision 3).
 *
 * Why this route exists: confirmations are ON, so an unconfirmed merchant cannot sign in,
 * and until SMTP is wired up the ONLY way out is a manual confirm from the super-admin panel.
 * A resend endpoint is the self-service half, and it is the difference between "the mail got
 * lost" and "the account is dead".
 *
 * Deliberate choices:
 * - The response is IDENTICAL whether or not the address has an account. A different answer
 *   for "no such user" turns this into an account-existence oracle for an anonymous caller.
 * - Rate limited per address AND per IP: without a budget this is an email-bombing tool that
 *   aims at a third party's inbox.
 * - Errors are logged to Sentry (ops needs to see a broken mail path) but never reflected in
 *   the client response.
 */

const EMAIL_RE = /^[^\s@]+@[^\s@]+\.[^\s@]+$/;

const GENERIC_MESSAGE = 'إذا كان الحساب موجوداً وغير مؤكد، أرسلنا رابط التأكيد. تحقق من بريدك.';

export async function POST(request: Request) {
  try {
    const body = await request.json().catch(() => null);
    if (body === null || typeof body !== 'object' || Array.isArray(body)) {
      return NextResponse.json({ error: 'بيانات غير صالحة' }, { status: 400 });
    }

    const raw = (body as { email?: unknown }).email;
    const email = typeof raw === 'string' ? raw.trim().toLowerCase() : '';
    if (!EMAIL_RE.test(email) || email.length > 254) {
      return NextResponse.json({ error: 'بريد إلكتروني غير صالح' }, { status: 400 });
    }

    const ip = getClientIp(request);
    const [byEmail, byIp] = await Promise.all([
      rateLimit(email, { limit: 3, windowMs: 15 * 60 * 1000, keyPrefix: 'resend-confirm' }),
      rateLimit(`ip:${ip}`, { limit: 10, windowMs: 60 * 60 * 1000, keyPrefix: 'resend-confirm-ip' }),
    ]);
    if (!byEmail.allowed) {
      const res = createRateLimitResponse(byEmail.resetIn);
      return NextResponse.json({ error: res.error }, { status: res.status });
    }
    if (!byIp.allowed) {
      const res = createRateLimitResponse(byIp.resetIn);
      return NextResponse.json({ error: res.error }, { status: res.status });
    }

    const { error } = await createAnonClient().auth.resend({ type: 'signup', email });

    if (error) {
      // Visible to ops, invisible to the caller — the caller's answer must not depend on
      // whether this address exists.
      Sentry.captureMessage(
        `resend-confirmation: provider returned ${error.code ?? error.status ?? 'error'}`,
        'info'
      );
    }

    return NextResponse.json({ success: true, message: GENERIC_MESSAGE });
  } catch (err: unknown) {
    Sentry.captureException(err);
    return NextResponse.json({ error: 'تعذر إرسال الرابط، حاول بعد قليل.' }, { status: 500 });
  }
}
