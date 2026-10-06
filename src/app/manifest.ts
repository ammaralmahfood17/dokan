import type { MetadataRoute } from 'next';

export default function manifest(): MetadataRoute.Manifest {
  return {
    name: 'دكان',
    short_name: 'دكان',
    description: 'إدارة طلبات المطاعم والمقاهي',
    id: '/',
    start_url: '/dashboard',
    scope: '/',
    display: 'standalone',
    background_color: '#FAF9F6',
    theme_color: '#7047EB',
    orientation: 'any',
    lang: 'ar',
    dir: 'rtl',
    categories: ['business', 'productivity'],
    prefer_related_applications: false,
    icons: [
      {
        src: '/icons/icon-192.png',
        sizes: '192x192',
        type: 'image/png',
        purpose: 'any',
      },
      {
        src: '/icons/icon-512.png',
        sizes: '512x512',
        type: 'image/png',
        purpose: 'any',
      },
      {
        src: '/icons/icon-maskable-512.png',
        sizes: '512x512',
        type: 'image/png',
        purpose: 'maskable',
      },
      {
        // A real maskable: its own file, its own safe-zone padding. This entry used to point
        // at icon-192.png, i.e. the 'any' artwork (mark at 72% of the canvas) was also
        // declared maskable, so Android's circular crop cut into the mark.
        src: '/icons/icon-maskable-192.png',
        sizes: '192x192',
        type: 'image/png',
        purpose: 'maskable',
      },
    ],
    // Rich install UI: shown by Chrome/Edge in the install dialog
    screenshots: [
      {
        src: '/screenshots/light.png',
        sizes: '750x1334',
        type: 'image/png',
        form_factor: 'narrow',
        label: 'دكان — لوحة التحكم',
      },
      // audit T1 #17: dark.png was a valid 750x1334 screenshot with no reference anywhere.
      // (The product has no dark MODE - the tokens are light-only - so this is the dark-styled
      // screenshot the store already shipped; registering it stops it being an orphan asset.)
      {
        src: '/screenshots/dark.png',
        sizes: '750x1334',
        type: 'image/png',
        form_factor: 'narrow',
        label: 'دكان — الوضع الليلي',
      },
    ],
    shortcuts: [
      {
        name: 'الطلبات',
        short_name: 'الطلبات',
        url: '/dashboard/orders',
        icons: [{ src: '/icons/icon-192.png', sizes: '192x192' }],
      },
      {
        name: 'شاشة المطبخ',
        short_name: 'المطبخ',
        url: '/dashboard/kitchen',
        icons: [{ src: '/icons/icon-192.png', sizes: '192x192' }],
      },
      {
        name: 'نقطة البيع',
        short_name: 'POS',
        url: '/dashboard/pos',
        icons: [{ src: '/icons/icon-192.png', sizes: '192x192' }],
      },
    ],
  };
}
