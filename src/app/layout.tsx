import type { Metadata, Viewport } from 'next';
// خط ثمانية (Thmanyah Typeface) — the faces live INLINE in fonts/thmanyah.css as data: URIs.
// Two reasons, both load-bearing:
//   1. LICENCE. The Thmanyah licence permits embedding the font in a website/app only as part
//      of a compiled product, and forbids hosting it or making it available as a font file at
//      any URL. A plain `url('/fonts/x.woff2')` would break that; a data: URI does not.
//   2. OFFLINE BUILD. next/font/google fetched from Google at BUILD time and broke CI twice
//      with "Module not found: @vercel/turbopack-next/internal/font/google/font" — a build
//      failure caused by something no file in this repo controls.
// Cost, measured: ~315KB of base64 (three weights of one family; the licence forbids
// subsetting). Was ~425KB until the owner unified the product on "thmanyah sans" and
// the two serif faces were dropped (2026-10-07). It is content-hashed and
// immutable-cached, so it is paid once per user.
// Rebuild: node scripts/build-thmanyah-fonts.mjs "<thmanyah typeface dir>"
import './fonts/thmanyah.css';
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

/**
 * iOS launch images. iOS matches these by device metrics, not by "nearest size", so
 * each entry is one physical device family. Only these four exist as artwork; an
 * unmatched device simply gets no splash image, which is the correct failure mode.
 */
const SPLASH_SCREENS = [
  // 375x812 @3x — iPhone X / XS / 11 Pro / 12–13 mini
  { file: '1125x2436.png', media: '(device-width: 375px) and (device-height: 812px) and (-webkit-device-pixel-ratio: 3)' },
  // 414x896 @3x — iPhone XS Max / XR / 11 Pro Max
  { file: '1242x2688.png', media: '(device-width: 414px) and (device-height: 896px) and (-webkit-device-pixel-ratio: 3)' },
  // 834x1194 @2x — iPad Pro 11"
  { file: '1668x2388.png', media: '(device-width: 834px) and (device-height: 1194px) and (-webkit-device-pixel-ratio: 2)' },
  // 1024x1366 @2x — iPad Pro 12.9"
  { file: '2048x2732.png', media: '(device-width: 1024px) and (device-height: 1366px) and (-webkit-device-pixel-ratio: 2)' },
];

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
      /* The family is applied through --font-sans (globals.css); the @font-face rules come
         from the imported fonts/thmanyah.css, so no variable class is needed. */
    >
      <head>
        {/* Supabase: early connect */}
        {supabaseUrl && (
          <>
            <link rel="preconnect" href={supabaseOrigin} />
            <link rel="dns-prefetch" href={supabaseOrigin} />
          </>
        )}
        {/* iOS touch icon. A dedicated opaque 180x180 — the old href pointed at the 512
            maskable, so iOS downscaled a launcher icon whose safe-zone padding made the
            mark read smaller than intended. */}
        <link rel="apple-touch-icon" sizes="180x180" href="/apple-touch-icon.png" />
        {/* iOS launch images. iOS picks a startup image by matching a media query against the
            device; an UNQUALIFIED link — which is what used to be here, one file with no
            media — is ignored by every device whose resolution it does not match exactly,
            i.e. all of them but one (1242x2688 is the iPhone XS Max). One link per
            resolution, each with its dark sibling, is the only shape that ever applies. */}
        {SPLASH_SCREENS.flatMap((s) => [
          <link
            key={`light-${s.file}`}
            rel="apple-touch-startup-image"
            href={`/splash/light-${s.file}`}
            media={`${s.media} and (prefers-color-scheme: light)`}
          />,
          <link
            key={`dark-${s.file}`}
            rel="apple-touch-startup-image"
            href={`/splash/dark-${s.file}`}
            media={`${s.media} and (prefers-color-scheme: dark)`}
          />,
        ])}
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
          // Sonner ships its own system-font stack and injects it inline on the
          // toast subtree, so toasts were the ONE piece of UI still rendering in
          // a system font instead of thmanyah sans. Single-family decision
          // (2026-10-07): give them the same family as the rest of the product.
          style={{ fontFamily: 'var(--font-sans)' }}
          toastOptions={{
            actionButtonStyle: { minHeight: '44px' },
            classNames: { toast: 'font-sans' },
          }}
        />
        <ServiceWorkerRegister />
        <WebVitals />
        <InstallPrompt />
      </body>
    </html>
  );
}
