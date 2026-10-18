import type { Metadata } from 'next';

/**
 * Metadata for the password-reset request route — see src/app/login/layout.tsx for why this is a
 * layout (client page) and why children are wrapped in <main> (audit F-6/F-8).
 *
 * Deliberately `noindex`: a recovery screen has no search value and every visit is one a merchant
 * reached from their inbox, not from Google.
 */
/** F-18: rendered per request so the proxy's CSP nonce reaches this client page. */
export const dynamic = 'force-dynamic';

export const metadata: Metadata = {
  title: 'استعادة كلمة المرور',
  description: 'أرسل رابط استعادة كلمة المرور لحسابك في دكان.',
  alternates: { canonical: '/reset-password' },
  robots: { index: false, follow: true },
};

export default function ResetPasswordLayout({ children }: { children: React.ReactNode }) {
  return <main className="min-h-dvh">{children}</main>;
}
