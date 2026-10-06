import type { Metadata, Viewport } from 'next';
// Self-hosted Cairo (2026-10 CI follow-up). The build used to fetch this font from Google at
// BUILD time via next/font/google; a runner that cannot reach fonts.googleapis.com fails the
// whole build with "Module not found: @vercel/turbopack-next/internal/font/google/font" - seen
// twice on CI for the same code, which is a broken build for a reason nothing in the repo
// controls. @fontsource-variable/cairo ships the woff2 in the npm package (build touches no
// network), and its CSS carries per-subset unicode-range (arabic + latin-ext + latin) which
// next/font/local cannot express per file.
import '@fontsource-variable/cairo';
import { Toaster } from 'sonner';
import { ServiceWorkerRegister } from '@/components/service-worker-register';
import { WebVitals } from '@/components/web-vitals';
import { getSiteUrl } from '@/lib/site-url';
// D15: install-to-homescreen prompt (beforeinstallprompt on Android/Chrome).
import { InstallPrompt } from '@/components/ui/install-prompt';
import './globals.css';

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
      /* The family is applied through --font-sans (globals.css); the font-face rules come from
         the imported @fontsource-variable/cairo package, so no variable class is needed. */
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
        {/* NOTE: no <link rel="prefetch" as="document"> for the dashboard routes here.
            These were four full HTML/RSC fetches fired for EVERY visitor — including an
            anonymous customer who just scanned a QR code on mobile data, for whom the
            merchant's /dashboard, /dashboard/kitchen, /dashboard/pos and /login are
            pure waste. A signed-in merchant still gets them warmed: the nav renders
            <Link>s to those routes, and Next prefetches those on viewport/hover. */}
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
