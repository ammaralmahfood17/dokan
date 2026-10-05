import type { Metadata, Viewport } from 'next';
import { Cairo } from 'next/font/google';
import { Toaster } from 'sonner';
import { ServiceWorkerRegister } from '@/components/service-worker-register';
import { WebVitals } from '@/components/web-vitals';
import { getSiteUrl } from '@/lib/site-url';
// D15: install-to-homescreen prompt (beforeinstallprompt on Android/Chrome).
import { InstallPrompt } from '@/components/ui/install-prompt';
import './globals.css';

// "دكان" — Enterprise identity v1.0
// Cairo only (400/500/600/700/800) — واجهة + أرقام + عناوين بخط واحد
const cairo = Cairo({
  subsets: ['arabic', 'latin'],
  weight: ['400', '500', '600', '700', '800'],
  variable: '--font-cairo',
  display: 'swap',
});

const supabaseUrl = process.env.NEXT_PUBLIC_SUPABASE_URL!;
const supabaseOrigin = supabaseUrl ? new URL(supabaseUrl).origin : '';

export const metadata: Metadata = {
  // A2: canonical base — relative metadata URLs (og image, canonical) resolve
  // against the site origin instead of leaking to vercel.app/www mirrors.
  metadataBase: new URL(getSiteUrl()),
  alternates: { canonical: '/' },
  title: {
    default: 'دكان — منصة إدارة المطاعم',
    template: '%s — دكان',
  },
  description: 'منصة سحابية لإدارة المطاعم والمقاهي في الخليج',
  // FIX-M-004: Open Graph + Twitter — المشاركة على واتساب/تيليجرام تعرض
  // عنوانًا وصورة بدل رابط أعمى.
  openGraph: {
    type: 'website',
    locale: 'ar_BH',
    url: getSiteUrl(),
    siteName: 'دكان',
    title: 'دكان — منصة إدارة المطاعم',
    description: 'منصة سحابية لإدارة المطاعم والمقاهي في الخليج',
    images: [
      {
        url: '/og-image.png',
        width: 1024,
        height: 576,
        alt: 'دكان — منصة إدارة المطاعم',
      },
    ],
  },
  twitter: {
    card: 'summary_large_image',
    title: 'دكان — منصة إدارة المطاعم',
    description: 'منصة سحابية لإدارة المطاعم والمقاهي في الخليج',
    images: ['/og-image.png'],
  },
  icons: [
    { rel: 'icon', url: '/favicon.ico', sizes: '32x32' },
    { rel: 'icon', url: '/icon.svg', type: 'image/svg+xml' },
  ],
  manifest: '/manifest.webmanifest',
  appleWebApp: {
    capable: true,
    title: 'دكان',
    statusBarStyle: 'default',
  },
  other: { 'mobile-web-app-capable': 'yes' },
};

export const viewport: Viewport = {
  width: 'device-width',
  initialScale: 1,
  // FIX-R-001: تفعيل safe areas على iPhone مع notch (env(safe-area-inset-*))
  viewportFit: 'cover',
  themeColor: '#FAF9F6',
};

export default function RootLayout({
  children,
}: {
  children: React.ReactNode;
}) {
  return (
    <html
      lang="ar"
      dir="rtl"
      suppressHydrationWarning
      className={`${cairo.variable}`}
    >
      <head>
        {/* Supabase: early connect */}
        {supabaseUrl && (
          <>
            <link rel="preconnect" href={supabaseOrigin} />
            <link rel="dns-prefetch" href={supabaseOrigin} />
          </>
        )}
        {/* iOS touch icons */}
        <link rel="apple-touch-icon" sizes="180x180" href="/icons/icon-maskable-512.png" />
        <link rel="apple-touch-startup-image" href="/splash/light-1242x2688.png" />
        {/* Preload critical routes */}
        <link rel="prefetch" href="/dashboard" as="document" />
        <link rel="prefetch" href="/dashboard/kitchen" as="document" />
        <link rel="prefetch" href="/dashboard/pos" as="document" />
        <link rel="prefetch" href="/login" as="document" />
      </head>
      <body>
        {/* D5: skip-to-content — keyboard users jump straight past the
            nav/chrome to the page content (visually hidden until focused). */}
        <a
          href="#main-content"
          className="sr-only focus:not-sr-only focus:fixed focus:top-4 focus:start-4 focus:z-[var(--z-skip-link)] focus:rounded-[var(--radius-md)] focus:bg-[var(--color-primary)] focus:px-4 focus:py-2 focus:text-sm focus:font-bold focus:text-white"
        >
          تخطي إلى المحتوى
        </a>
        <div id="main-content">
          {children}
        </div>
        {/* actionButtonStyle: sonner's default action button renders ~24px tall, which
            is under the 44px touch contract on a phone — and this specific action
            ("إعادة تحميل") appears after EVERY deploy, i.e. on the merchant's device. */}
        <Toaster
          position="top-center"
          richColors
          dir="rtl"
          toastOptions={{ actionButtonStyle: { minHeight: '44px' } }}
        />
        <ServiceWorkerRegister />
        <WebVitals />
        <InstallPrompt />
      </body>
    </html>
  );
}
