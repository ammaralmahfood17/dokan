import type { Metadata } from 'next';

/**
 * Metadata for the sign-in route.
 *
 * WHY A LAYOUT (frontend audit F-6/F-8, 2026-10-16): `page.tsx` is a client component
 * (`'use client'` — it owns the form state), and Next forbids exporting `metadata` from one. So
 * /login inherited the ROOT layout's title — measured live: five routes all served
 * «دكان — منصة إدارة المطاعم» while `/login`'s canonical pointed at the homepage, i.e. every auth
 * page told Google it was a duplicate of the landing page.
 *
 * The same file fixes the missing landmark: /login, /register and /reset-password had NO <main>
 * (axe: `landmark-one-main` + `region` x3-7), so the skip link in the root layout jumped to a div.
 */
export const metadata: Metadata = {
  title: 'تسجيل الدخول',
  description: 'سجّل الدخول إلى لوحة تحكم دكان لإدارة طلبات مطعمك ومقهاك.',
  alternates: { canonical: '/login' },
  robots: { index: true, follow: true },
};

export default function LoginLayout({ children }: { children: React.ReactNode }) {
  return <main className="min-h-dvh">{children}</main>;
}
