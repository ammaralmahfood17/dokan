'use client';

import Link from 'next/link';
import { useRouter } from 'next/navigation';
import { FormEvent, useCallback, useState } from 'react';
import { Button } from '@/components/ui/button';
import { TurnstileWidget } from '@/components/turnstile-widget';
import { ResendConfirmationButton } from '@/components/resend-confirmation-button';

export default function RegisterPage() {
  const router = useRouter();
  const [fullName, setFullName] = useState('');
  const [email, setEmail] = useState('');
  const [password, setPassword] = useState('');
  const [error, setError] = useState<string | null>(null);
  const [loading, setLoading] = useState(false);
  // Owner decisions 7 + 8: confirmations are ON, so a successful signup means "go confirm
  // your email", not "you are logged in".
  const [sent, setSent] = useState(false);
  const [turnstileToken, setTurnstileToken] = useState('');
  const [touched, setTouched] = useState<{ email?: boolean; password?: boolean }>({});

  const handleTurnstileExpire = useCallback(() => setTurnstileToken(''), []);

  const emailErr = touched.email && !/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(email) ? 'الإيميل غير صحيح' : null;
  // UX only — the authoritative check is the signup API (src/lib/password-policy.ts, whose
  // MIN_PASSWORD_LENGTH is 10). Keep this in step with it: a drifted client rule is a
  // confusing error, never a security hole.
  const passErr = touched.password && password.length < 10 ? 'كلمة المرور أقل من 10 أحرف' : null;

  async function onSubmit(e: FormEvent) {
    e.preventDefault();
    setError(null);
    setLoading(true);

    try {
      const apiRes = await fetch('/api/auth/signup', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          email: email.trim(),
          password,
          fullName: fullName.trim(),
          turnstileToken,
        }),
      });

      const apiJson = await apiRes.json();

      if (!apiRes.ok) {
        const fullErr = JSON.stringify(apiJson, null, 2);
        setError(fullErr || apiJson?.error || 'فشل إنشاء الحساب');
        setLoading(false);
        return;
      }

      // Owner decision 7: with confirmations ON there is no session to create here — the
      // merchant confirms by email first. Pushing to /onboarding would bounce them straight
      // back to /login, which is exactly the confusing dead end this replaces.
      setLoading(false);
      setSent(true);
    } catch {
      setError('حدث خطأ غير متوقع أثناء إنشاء الحساب.');
      setLoading(false);
    }
  }

  if (sent) {
    return (
      <div className="storefront flex min-h-dvh items-center justify-center bg-[var(--color-bg)] px-4 py-10">
        <div className="card card-body w-full max-w-sm text-center">
          <h1 className="text-xl font-bold">تأكيد البريد الإلكتروني</h1>
          <p className="mt-2 text-sm leading-6 text-[var(--color-text-secondary)]">
            أرسلنا رابط تأكيد إلى{' '}
            <span dir="ltr" className="font-semibold text-[var(--color-text)]">
              {email.trim()}
            </span>
            . افتح الرابط لتأكيد حسابك، بعدها سجّل الدخول وابدأ بإعداد متجرك.
          </p>
          <Button block className="mt-4" onClick={() => router.push('/login')}>
            تسجيل الدخول
          </Button>
          {/* Until SMTP is wired up (owner decision 3) the mail may simply never arrive; the
              super-admin panel can confirm the account by hand. */}
          <ResendConfirmationButton email={email.trim()} className="mt-3" />
        </div>
      </div>
    );
  }

  return (
    <div className="storefront flex min-h-dvh items-center justify-center bg-[var(--color-bg)] px-4 py-10">
      <div className="w-full max-w-sm">
        <div className="mb-6 text-center">
          <div className="mx-auto mb-3 flex h-10 w-10 items-center justify-center rounded-[var(--radius-md)] bg-[var(--color-primary)] text-white font-bold">
            د
          </div>
          <h1 className="text-xl font-bold">إنشاء حساب</h1>
          <p className="mt-1 text-sm text-[var(--color-text-secondary)]">
            ابدأ متجرك في دقائق
          </p>
        </div>

        <form onSubmit={onSubmit} className="card card-body space-y-1">
          <div className="field">
            <label className="label" htmlFor="fullName">
              الاسم
            </label>
            <input
              id="fullName"
              name="fullName"
              className="input"
              required
              maxLength={80}
              value={fullName}
              onChange={(e) => setFullName(e.target.value)}
            />
          </div>
          <div className="field">
            <label className="label" htmlFor="email">
              البريد الإلكتروني
            </label>
            <input
              id="email"
              name="email"
              className={`input ${emailErr ? 'input-error' : ''}`}
              type="email"
              autoComplete="email"
              required
              maxLength={254}
              value={email}
              onChange={(e) => setEmail(e.target.value)}
              onBlur={() => setTouched((t) => ({ ...t, email: true }))}
              dir="ltr"
              aria-invalid={!!emailErr}
              aria-describedby={emailErr ? 'email-error' : undefined}
            />
            {emailErr && <p id="email-error" className="error-text" role="alert">{emailErr}</p>}
          </div>
          <div className="field">
            <label className="label" htmlFor="password">
              كلمة المرور
            </label>
            <input
              id="password"
              name="password"
              className={`input ${passErr ? 'input-error' : ''}`}
              type="password"
              autoComplete="new-password"
              required
              minLength={10}
              maxLength={72}
              value={password}
              onChange={(e) => setPassword(e.target.value)}
              onBlur={() => setTouched((t) => ({ ...t, password: true }))}
              dir="ltr"
              aria-invalid={!!passErr}
              aria-describedby={passErr ? 'password-error' : 'password-hint'}
            />
            {passErr && <p id="password-error" className="error-text" role="alert">{passErr}</p>}
            {!passErr && <p id="password-hint" className="hint">10 أحرف على الأقل</p>}
          </div>
          {/* Renders only when NEXT_PUBLIC_TURNSTILE_SITE_KEY is set; the server makes the
              same decision on its own (src/lib/turnstile.ts). */}
          <TurnstileWidget onToken={setTurnstileToken} onExpire={handleTurnstileExpire} />
          {error && <p className="error-text mb-3">{error}</p>}
          <Button type="submit" block disabled={loading || !!emailErr || !!passErr}>
            {loading ? 'جاري الإنشاء…' : 'إنشاء الحساب'}
          </Button>
        </form>

        <p className="mt-4 text-center text-sm text-[var(--color-text-secondary)]">
          لديك حساب؟{' '}
          <Link href="/login" className="font-semibold text-[var(--color-primary)]">
            دخول
          </Link>
        </p>
      </div>
    </div>
  );
}
