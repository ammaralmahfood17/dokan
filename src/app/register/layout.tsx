import type { Metadata } from 'next';

/**
 * Metadata for the signup route — see src/app/login/layout.tsx for why this is a layout
 * (the page is a client component) and why it wraps children in <main> (audit F-6/F-8).
 */
export const metadata: Metadata = {
  title: 'إنشاء حساب',
  description: 'أنشئ متجرك على دكان: قائمة QR، طلبات لحظية، شاشة مطبخ ونقطة بيع — 14 يوم مجاناً.',
  alternates: { canonical: '/register' },
  robots: { index: true, follow: true },
};

export default function RegisterLayout({ children }: { children: React.ReactNode }) {
  return <main className="min-h-dvh">{children}</main>;
}
