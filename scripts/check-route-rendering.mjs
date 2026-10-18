#!/usr/bin/env node
/**
 * F-18 guard: the proxy stamps a CSP nonce on pages that render per request. A PRERENDERED page
 * served with that header has no nonce in its HTML, so every script on it would be blocked —
 * a silent breakage that only shows up in the browser. This fails the build when a page that is
 * not on the static allow-list ends up prerendered.
 *
 * The allow-list is deliberately tiny:
 *   • `/[projectSlug]/menu/[tableSlug]` — the customer menu, cached for QR-scan speed (it is an
 *     on-demand static route, so it appears under `dynamicRoutes`).
 *   • the 404 shell and the generated files (robots/sitemap/manifest) — no nonce, no problem:
 *     src/lib/csp.ts gives those paths the static policy.
 */
import { readFileSync } from 'node:fs';

const manifest = JSON.parse(readFileSync('.next/prerender-manifest.json', 'utf8'));

const ALLOWED_STATIC = new Set([
  '/_not-found',
  '/_global-error',
  '/robots.txt',
  '/sitemap.xml',
  '/manifest.webmanifest',
]);
const MENU = /^\/[^/]+\/menu\/[^/]+$/;

const staticOffenders = Object.keys(manifest.routes ?? {}).filter(
  (route) => !ALLOWED_STATIC.has(route) && !route.startsWith('/api')
);
const dynamicOffenders = Object.keys(manifest.dynamicRoutes ?? {}).filter((route) => !MENU.test(route));

if (staticOffenders.length || dynamicOffenders.length) {
  console.error('A page that gets a CSP nonce is prerendered — its scripts would be blocked.');
  for (const route of staticOffenders) console.error(`  prerendered: ${route}`);
  for (const route of dynamicOffenders) console.error(`  on-demand static: ${route}`);
  console.error('Either render it per request (dynamic = "force-dynamic") or exclude it in src/lib/csp.ts.');
  process.exit(1);
}

console.log(
  `ok — ${Object.keys(manifest.dynamicRoutes ?? {}).length} cached menu route(s); every nonce route renders per request`
);
