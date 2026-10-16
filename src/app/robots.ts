import { getSiteUrl } from '@/lib/site-url';

/**
 * robots.txt — allow all crawlers on canonical domain, disallow dashboard/api.
 * On *.vercel.app hosts, X-Robots-Tag: noindex is set via next.config.ts
 * (A2 domain canonicalization) so search engines never index preview deploys.
 */
export default function robots() {
  const siteUrl = getSiteUrl();
  return {
    rules: [
      {
        userAgent: '*',
        allow: '/',
        // F-19: /offline.html is the service worker's fallback shell, not a page anyone
        // should land on from a search result.
        disallow: ['/dashboard', '/api', '/super-admin', '/offline.html'],
      },
    ],
    sitemap: `${siteUrl}/sitemap.xml`,
  };
}