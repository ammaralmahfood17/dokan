import Link from 'next/link';
import { MessageCircle } from 'lucide-react';
import RegisterForm from './register-form';
import { SIGNUP_WHATSAPP_URL } from '@/lib/support';

/**
 * UX-02: self-serve signup is paused (SIGNUP_ENABLED=false since 2026-10-06, and it cannot be
 * switched on until the auth.users column defaults are fixed and Turnstile keys exist). The
 * landing used to send every visitor into a form that answered 503 — this gate replaces that
 * dead end with the channel that actually opens a store today. Flip the env flag and the real
 * form comes back; no code change.
 */
export default function RegisterPage() {
  // Fail CLOSED: only the literal `true` opens self-serve signup. Before this, any unset or
  // mistyped value ("True", "1", a trailing space) rendered the form while the API answered 503 —
  // the exact dead end UX-02 removed.
  if (process.env.SIGNUP_ENABLED === 'true') {
    return <RegisterForm />;
  }

  return (
    <div className="storefront flex min-h-dvh items-center justify-center bg-[var(--color-bg)] px-4 py-10">
      <div className="w-full max-w-sm">
        <div className="mb-6 text-center">
          <div className="mx-auto mb-3 flex h-10 w-10 items-center justify-center rounded-[var(--radius-md)] bg-[var(--color-primary)] font-bold text-white">
            د
          </div>
          <h1 className="text-xl font-bold">التسجيل الذاتي متوقف مؤقتاً</h1>
          <p className="mt-2 text-sm leading-7 text-[var(--color-text-secondary)]">
            نفتح المتاجر يدوياً هذه الفترة: ننشئ لك الحساب، ونرفع قائمتك، ونشغّل شاشة
            المطبخ ونقطة البيع معك. راسلنا على واتساب ونجهّزها في نفس اليوم.
          </p>
        </div>

        <div className="card card-body">
          <a
            href={SIGNUP_WHATSAPP_URL}
            target="_blank"
            rel="noopener noreferrer"
            className="btn btn-primary btn-lg w-full"
          >
            <MessageCircle className="h-4 w-4" />
            اطلب فتح متجرك
          </a>
          <p className="mt-3 text-center text-caption leading-6 text-[var(--color-text-tertiary)]">
            14 يوم تجربة مجانية كاملة — بلا بطاقة ائتمان.
          </p>
        </div>

        <p className="mt-4 text-center text-sm text-[var(--color-text-secondary)]">
          لديك حساب؟{' '}
          <Link
            href="/login"
            className="inline-flex min-h-[44px] items-center font-semibold text-[var(--color-primary)]"
          >
            دخول
          </Link>
        </p>
      </div>
    </div>
  );
}
