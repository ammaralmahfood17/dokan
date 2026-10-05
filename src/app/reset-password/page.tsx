'use client';

import Link from 'next/link';
import { FormEvent, useState } from 'react';
import { Mail, ArrowLeft, CheckCircle2 } from 'lucide-react';
import { Button } from '@/components/ui/button';

export default function ResetPasswordPage() {
  const [email, setEmail] = useState('');
  const [loading, setLoading] = useState(false);
  const [done, setDone] = useState(false);
  const [error, setError] = useState<string | null>(null);

  async function onSubmit(e: FormEvent) {
    e.preventDefault();
    if (!email.trim()) return;
    setLoading(true);
    setError(null);

    try {
      const res = await fetch('/api/auth/reset-password', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ email: email.trim() }),
      });
      const data = (await res.json()) as { error?: string };
      if (!res.ok) {
        setError(data.error || 'فشل إرسال رابط إعادة التعيين');
      } else {
        setDone(true);
      }
    } catch {
      setError('تعذّر الاتصال بالخادم');
    } finally {
      setLoading(false);
    }
  }

  return (
    <div className="storefront flex min-h-dvh items-center justify-center bg-[var(--color-bg)] px-4 py-10">
      <div className="w-full max-w-sm">
        <div className="mb-6 text-center">
          <div className="mx-auto mb-3 flex h-10 w-10 items-center justify-center rounded-[var(--radius-md)] bg-[var(--color-primary)] text-base font-bold text-white">
            د
          </div>
          <h1 className="text-xl font-bold">إعادة تعيين كلمة المرور</h1>
          <p className="mt-1 text-sm text-[var(--color-text-secondary)]">
            أدخل بريدك الإلكتروني وسنرسل لك رابط إعادة التعيين
          </p>
        </div>

        {done ? (
          <div className="card card-body text-center">
            <CheckCircle2 className="mx-auto mb-3 h-10 w-10 text-[var(--color-success)]" />
            <h2 className="text-base font-bold">تم الإرسال</h2>
            <p className="mt-1 text-sm text-[var(--color-text-secondary)]">
              إذا كان البريد الإلكتروني مسجلاً لدينا، ستتلقى رابط إعادة تعيين كلمة المرور.
            </p>
            <Link
              href="/login"
              className="btn btn-primary mt-4 inline-flex"
            >
              العودة لتسجيل الدخول
            </Link>
          </div>
        ) : (
          <form onSubmit={onSubmit} className="card card-body space-y-4">
            {error && (
              <div className="rounded-[var(--radius-md)] border border-[var(--color-danger)]/20 bg-[var(--color-danger-tint)] px-3 py-2 text-xs text-[var(--color-danger)]">
                {error}
              </div>
            )}
            <div className="field">
              <label className="label" htmlFor="email">البريد الإلكتروني</label>
              <input
                id="email"
                className="input"
                type="email"
                autoComplete="email"
                required
                maxLength={254}
                value={email}
                onChange={(e) => setEmail(e.target.value)}
                dir="ltr"
                placeholder="name@example.com"
              />
            </div>
            <Button type="submit" block disabled={loading || !email.trim()}>
              {loading ? 'جاري الإرسال…' : 'إرسال رابط إعادة التعيين'}
            </Button>
            <div className="text-center">
              <Link
                href="/login"
                className="text-xs font-semibold text-[var(--color-text-secondary)] hover:text-[var(--color-primary)]"
              >
                <ArrowLeft className="inline h-3 w-3 align-middle" /> العودة لتسجيل الدخول
              </Link>
            </div>
          </form>
        )}
      </div>
    </div>
  );
}
