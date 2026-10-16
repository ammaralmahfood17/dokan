/**
 * Next.js client instrumentation — registers Sentry in the BROWSER.
 *
 * Why this file exists (added 2026-09-26): `@sentry/nextjs` v10 only injects
 * the client SDK through `instrumentation-client.ts`. The project had
 * `sentry.client.config.ts` instead, which the SDK explicitly refuses to read —
 * its own build hook prints:
 *
 *   "It appears you've configured a `sentry.client.config.ts` file. Please
 *    ensure to put this file's content into the `register()` function of a Next.js
 *    instrumentation file instead… You can safely delete the file afterward."
 *
 * (`getClientSentryConfigFile` exists in config/webpack.js, but the v10 client
 * entry point comes from `getInstrumentationClientFile` — the four locations
 * checked there are the only ones honoured.)
 *
 * Consequence before this file: every browser-side error (the majority of real
 * reports — render crashes, hydration mismatches, unhandled rejections) was
 * silently dropped. Server/edge errors were fine: `src/instrumentation.ts`
 * already existed and imports sentry.server/edge.config on the right runtime.
 *
 * This is a copy of the old sentry.client.config.ts, kept verbatim so the PII
 * policy stays identical (sendDefaultPii off, ip_address stripped).
 */
import * as Sentry from '@sentry/nextjs';
import { scrubSentryBreadcrumb, scrubSentryEvent } from '@/lib/sentry-scrub';

/**
 * Promote the deferred Thmanyah sheet to an applying stylesheet.
 *
 * WHY (frontend audit F-1, 2026-10-16): the font sheet is 231KB brotli / 315KB decoded and used
 * to be a CSS import, i.e. the ONE render-blocking resource on every route — measured FCP 3.27s
 * on Slow-4G and 11.1-12.8s on Slow-3G, with its arrival time equal to the first paint. It now
 * arrives as `<link media="print">` (fetched, not blocking) and this flips it to `media="all"`.
 *
 * Deliberately here rather than an inline `onload=` attribute: React does not serialize event
 * handlers to SSR'd HTML, and a raw `onload` string prop fails `tsc` and trips
 * `@next/next/no-css-tags`. This runs once, before hydration, and is a no-op if the link is
 * absent (the layout is the only place that emits it).
 */
if (typeof document !== 'undefined') {
  const promoteFontSheet = () => {
    const link = document.querySelector<HTMLLinkElement>('link[data-font-sheet]');
    if (link && link.media !== 'all') link.media = 'all';
  };
  // Already parsed (the common case: instrumentation loads after the HTML head).
  promoteFontSheet();
  // Belt and braces for a streamed/slow head.
  document.addEventListener('DOMContentLoaded', promoteFontSheet, { once: true });
}

export const onRouterTransitionStart = Sentry.captureRouterTransitionStart;

const clientDsn = process.env.NEXT_PUBLIC_SENTRY_DSN;

if (clientDsn) {
  Sentry.init({
    dsn: clientDsn,
    tracesSampleRate: 0.1,
    // No session replays by default — a merchant's dashboard is customer data.
    // Errors still sample, so a broken flow can be replayed on demand later.
    replaysSessionSampleRate: 0,
    replaysOnErrorSampleRate: 0.1,
    environment: process.env.VERCEL_ENV || 'development',
    // PII policy: never send user data. The merchant's customers are PII.
    sendDefaultPii: false,
    beforeSend(event) {
      // Browser events have no `request` object (that's server/edge); the only
      // PII that can appear here is user.ip_address via the Replay integration.
      if (event.user) delete event.user.ip_address;
      // A2: in the browser the token shows up in the event's own URL, in the transaction
      // name (the route path) and in fetch breadcrumbs — this is the runtime where a
      // customer's menu URL is most likely to be reported.
      return scrubSentryEvent(event);
    },
    // A2: every fetch to /api/public/order carries ?k=… in the breadcrumb trail.
    beforeBreadcrumb(breadcrumb) {
      return scrubSentryBreadcrumb(breadcrumb);
    },
  });
}
