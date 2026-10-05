/**
 * Sentry server config — API route / server-component errors.
 * Disabled until SENTRY_DSN is set (SDK no-ops without a DSN).
 *
 * PII policy: session cookies and Authorization headers must never reach
 * Sentry — a leaked event would be a live Supabase session.
 */
import * as Sentry from '@sentry/nextjs';
import { scrubSentryBreadcrumb, scrubSentryEvent } from '@/lib/sentry-scrub';

const dsn = process.env.SENTRY_DSN || process.env.NEXT_PUBLIC_SENTRY_DSN;

if (dsn) {
  Sentry.init({
    dsn,
    tracesSampleRate: 0.1,
    environment: process.env.VERCEL_ENV || 'development',
    sendDefaultPii: false,
    beforeSend(event) {
      delete event.request?.cookies;
      if (event.request?.headers) {
        delete event.request.headers['authorization'];
        delete event.request.headers['cookie'];
        delete event.request.headers['apikey'];
      }
      if (event.user) delete event.user.ip_address;
      // A2: the table scan token travels in ?k= on the customer menu URL, and a request URL
      // is exactly what a server/edge event carries. Scrub before it leaves the process.
      return scrubSentryEvent(event);
    },
    // A2: breadcrumbs are the other surface (fetch/xhr breadcrumbs hold data.url).
    beforeBreadcrumb(breadcrumb) {
      return scrubSentryBreadcrumb(breadcrumb);
    },
  });
}
