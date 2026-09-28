import * as Sentry from '@sentry/nextjs';
import { createAdminClient } from './supabase/admin';
import { getSiteUrl } from './site-url';

export interface PushPayload {
  title: string;
  body: string;
  url?: string;
  tag?: string;
}

/**
 * Send a push notification to all staff of a project
 * Returns { sent, failed } counts
 */
export async function sendPushToProject(
  projectId: string,
  payload: PushPayload
) {
  if (typeof window !== 'undefined') {
    // Called accidentally from client — silently skip.
    // NOTE: must check `window`, NOT `navigator` — Node 21+ (Vercel uses 24.x)
    // ships a global `navigator`, so that guard always fired server-side and
    // silently skipped every push in production.
    return { sent: 0, failed: 0 };
  }

  const webpush = await import('web-push');
  const publicKey = process.env.NEXT_PUBLIC_VAPID_PUBLIC_KEY!;
  const privateKey = process.env.VAPID_PRIVATE_KEY!;
  const contact =
    process.env.VAPID_CONTACT ||
    `mailto:admin@${new URL(getSiteUrl()).hostname}`;

  if (!publicKey || !privateKey) {
    console.warn('[Push] VAPID keys not configured — skipping');
    return { sent: 0, failed: 0, cleaned: 0 };
  }

  webpush.setVapidDetails(contact, publicKey, privateKey);

  const admin = createAdminClient();

  // Only staff who opted in for push (notify_push) receive order alerts.
  // Fetch opted-in staff ids FIRST, then filter subscriptions — passing a
  // query builder into .in() throws "object is not iterable" (TypeError).
  const { data: optedInStaff } = await admin
    .from('staff_members')
    .select('user_id')
    .eq('project_id', projectId)
    .eq('notify_push', true);

  const optedInIds = (optedInStaff ?? []).map((staff) => staff.user_id);
  if (!optedInIds.length) return { sent: 0, failed: 0, cleaned: 0 };

  const { data: subs } = await admin
    .from('push_subscriptions')
    .select('endpoint, p256dh, auth')
    .eq('project_id', projectId)
    .in('user_id', optedInIds);

  if (!subs?.length) return { sent: 0, failed: 0, cleaned: 0 };

  const results = await Promise.allSettled(
    subs.map((sub) =>
      webpush.sendNotification(
        {
          endpoint: sub.endpoint,
          keys: { p256dh: sub.p256dh, auth: sub.auth },
        },
        JSON.stringify(payload),
        { urgency: 'high' }
      )
    )
  );

  let sent = 0;
  let failed = 0;
  const expiredEndpoints: string[] = [];

  for (let i = 0; i < results.length; i++) {
    const r = results[i];
    if (r.status === 'fulfilled') {
      sent++;
    } else {
      failed++;
      // B7: web-push lacks TS types for the error object — narrow through
      // unknown instead of `as any` (keeps type safety at the boundary).
      const reason = r.reason as unknown as {
        statusCode?: number;
        body?: string;
        message?: string;
      };
      // The push FAILED — a failed delivery means a merchant never heard their
      // new order, which is a business-critical event. It must be visible in
      // production: report to Sentry (which is registered — see
      // src/instrumentation-client.ts and sentry.server.config.ts). The old
      // `NODE_ENV !== 'production'` guard made every real delivery failure
      // completely invisible, so a broken VAPID key or an expired endpoint
      // looked identical to success from the outside.
      Sentry.captureMessage(
        `[Push] delivery failed: ${reason?.statusCode ?? 'no status'} ${
          reason?.body || reason?.message || 'unknown'
        }`,
        { level: reason?.statusCode === 410 || reason?.statusCode === 404 ? 'info' : 'warning' }
      );
      // Keep the per-subscription line for local debugging only — in
      // production it is pure noise on top of the Sentry event.
      if (process.env.NODE_ENV !== 'production') {
        console.log('[Push] sub', i, 'FAILED —', reason?.statusCode, reason?.body || reason?.message);
      }
      if (reason?.statusCode === 410 || reason?.statusCode === 404) {
        expiredEndpoints.push(subs[i].endpoint);
      }
    }
  }

  if (process.env.NODE_ENV !== 'production') {
    console.log('[Push] result — sent:', sent, 'failed:', failed, 'cleaned:', expiredEndpoints.length);
  }

  // A run where EVERY notification failed means the merchant heard nothing at
  // all — that is an outage, not per-subscription noise, and it is invisible
  // without this. The per-submission failures above are already reported, so
  // this fires only for the total-loss case.
  if (subs.length > 0 && sent === 0) {
    Sentry.captureMessage(
      `[Push] ALL ${failed} notification deliveries failed for project ${projectId} — merchant received nothing`,
      'error'
    );
  } else if (failed > 0) {
    Sentry.captureMessage(
      `[Push] ${failed}/${subs.length} deliveries failed for project ${projectId}`,
      'warning'
    );
  }

  // Clean up expired subscriptions
  if (expiredEndpoints.length > 0) {
    await admin
      .from('push_subscriptions')
      .delete()
      .in('endpoint', expiredEndpoints);
  }

  return { sent, failed, cleaned: expiredEndpoints.length };
}
