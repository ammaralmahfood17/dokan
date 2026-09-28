/**
 * Sentry edge config — edge runtime routes.
 * Disabled until SENTRY_DSN is set (SDK no-ops without a DSN).
 *
 * Same PII policy as the server config: scrub cookies/auth before send.
 */
import * as Sentry from '@sentry/nextjs';

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
      return event;
    },
  });
}
