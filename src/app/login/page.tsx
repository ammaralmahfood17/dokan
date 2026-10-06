'use client';

import Link from 'next/link';
import { useRouter, useSearchParams } from 'next/navigation';
import { FormEvent, Suspense, useState } from 'react';
import { createClient } from '@/lib/supabase/client';
import { DokanMark } from '@/components/brand/dokan-mark';
import { classifyAuthError } from '@/lib/auth-errors';
import { ResendConfirmationButton } from '@/components/resend-confirmation-button';
import { Button } from '@/components/ui/button';
import { Eye, EyeOff } from 'lucide-react';

function RegisteredNotice() {
  const searchParams = useSearchParams();
  if (searchParams.get('registered') !== '1') return null;
  return (
    <p className="mt-3 rounded-[var(--radius-md)] border border-[var(--color-border)] bg-[var(--color-primary-tint)] px-3 py-2 text-center text-xs font-semibold text-[var(--color-primary)]">
      تم إنشاء الحساب. يمكنك تسجيل الدخول الآن.
    </p>
  );
}

function LoginForm() {
  const router = useRouter();
  const searchParams = useSearchParams();
  const nextParam = searchParams.get('next');

  const [showPass, setShowPass] = useState(false); // FIX-S-007
  const [email, setEmail] = useState('');
  const [password, setPassword] = useState('');
  const [error, setError] = useState<string | null>(null);
  // Only ONE error kind is actionable (amendment A5): an unconfirmed account.
  const [canResend, setCanResend] = useState(false);
  const [loading, setLoading] = useState(false);
  const [touched, setTouched] = useState<{ email?: boolean; password?: boolean }>({});

  const emailErr = touched.email && !/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(email) ? 'الإيميل غير صحيح' : null;
  // Deliberately 6, NOT the signup floor of 10 (audit T2 #2): accounts created before the
  // floor existed still have shorter passwords and must be able to sign in. Raising this
  // would lock real merchants out of their own store.
  const passErr = touched.password && password.length < 6 ? 'كلمة المرور أقل من 6 أحرف' : null;

  async function onSubmit(e: FormEvent) {
    e.preventDefault();
    setError(null);
    setCanResend(false);
    setLoading(true);

    const supabase = createClient();
    const { data, error: authError } = await supabase.auth.signInWithPassword({
      email: email.trim(),
      password,
    });

    if (authError || !data.user) {
      setLoading(false);
      // Amendment A5 (decision 3): confirmations are ON, so "this account is not confirmed
      // yet" is a NORMAL state that used to be reported as a wrong password — sending the
      // merchant to hunt for a password they typed correctly.
      const classified = classifyAuthError(authError);
      setError(classified.message);
      setCanResend(classified.canResend);
      return;
    }

    // Route by account type:
    //   super admin → /super-admin/subscriptions
    //   store owner/staff → /dashboard
    //   no store yet → /onboarding
    // Super admin takes priority over nextParam (a logged-in super admin
    // never needs the guest redirect chain).
    const { data: isSuperAdmin } = await supabase.rpc('is_super_admin');
    let dest = isSuperAdmin
      ? '/super-admin/subscriptions'
      : nextParam || '/dashboard';
    if (!isSuperAdmin && !nextParam) {
      const { data: membership } = await supabase
        .from('staff_members')
        .select('id')
        .eq('user_id', data.user.id)
        .limit(1)
        .maybeSingle();
      dest = membership ? '/dashboard' : '/onboarding';
    }

    setLoading(false);
    router.push(dest);
    router.refresh();
  }

  const blur = (field: 'email' | 'password') => () => setTouched((t) => ({ ...t, [field]: true }));

  return (
    <form onSubmit={onSubmit} className="card card-body space-y-1">
      <div className="field">
        <label className="label" htmlFor="email">البريد الإلكتروني</label>
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
          onBlur={blur('email')}
          dir="ltr"
          aria-invalid={!!emailErr}
          aria-describedby={emailErr ? 'email-error' : undefined}
        />
        {emailErr && (
          <p id="email-error" className="error-text" role="alert">
            {emailErr}
          </p>
        )}
      </div>
      <div className="field">
        <label className="label" htmlFor="password">كلمة المرور</label>
        <div className="relative">
          <input
            id="password"
            name="password"
            className={`input pe-10 ${passErr ? 'input-error' : ''}`}
            type={showPass ? 'text' : 'password'}
            autoComplete="current-password"
            required
            minLength={6}
            maxLength={72}
            value={password}
            onChange={(e) => setPassword(e.target.value)}
            onBlur={blur('password')}
            dir="ltr"
            aria-invalid={!!passErr}
            aria-describedby={passErr ? 'password-error' : undefined}
          />
          <button
            type="button"
            onClick={() => setShowPass((v) => !v)}
            aria-label={showPass ? 'إخفاء كلمة المرور' : 'إظهار كلمة المرور'}
            aria-pressed={showPass}
            className="absolute end-1 top-1/2 flex h-11 w-11 -translate-y-1/2 items-center justify-center rounded-[var(--radius-sm)] text-[var(--color-text-muted)] transition-colors hover:text-[var(--color-text)]"
          >
            {showPass ? <EyeOff className="h-4 w-4" /> : <Eye className="h-4 w-4" />}
          </button>
        </div>
        {passErr && (
          <p id="password-error" className="error-text" role="alert">
            {passErr}
          </p>
        )}
      </div>
      {error && <p className="error-text mb-3">{error}</p>}
      {canResend && email.trim() !== '' && (
        <ResendConfirmationButton email={email.trim()} className="mb-2 text-center" />
      )}
      <Button type="submit" block disabled={loading || !!emailErr || !!passErr}>
        {loading ? 'جاري الدخول…' : 'دخول'}
      </Button>
      <div className="mt-3 text-center">
        <Link href="/reset-password" className="text-xs font-semibold text-[var(--color-primary)] hover:underline">
          نسيت كلمة المرور؟
        </Link>
      </div>
    </form>
  );
}

export default function LoginPage() {
  return (
    <div className="storefront flex min-h-dvh items-center justify-center bg-[var(--color-bg)] px-4 py-10">
      <div className="w-full max-w-sm">
        <div className="mb-6 text-center">
          <DokanMark className="mx-auto mb-3 h-14 w-14" label="دكان" />
          <h1 className="text-xl font-bold">تسجيل الدخول</h1>
          <p className="mt-1 text-sm text-[var(--color-text-secondary)]">مرحباً بك في دكان</p>
        </div>
        <Suspense fallback={<div className="card card-body">جاري التحميل…</div>}>
          <LoginForm />
          <RegisteredNotice />
        </Suspense>
        <p className="mt-4 text-center text-sm text-[var(--color-text-secondary)]">
          ليس لديك حساب؟{' '}
          <Link href="/register" className="font-semibold text-[var(--color-primary)]">إنشاء حساب</Link>
        </p>
      </div>
    </div>
  );
}
