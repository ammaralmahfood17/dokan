/**
 * Realtime tenant guard — audit Task 2, finding #5 (amendment A7).
 *
 * The dashboard and the kitchen board subscribe to `orders` with **no project_id filter**,
 * because a filter combined with RLS on the same column made Realtime drop every event. The
 * whole cross-tenant guarantee therefore rests on "Supabase Realtime honours RLS for
 * postgres_changes".
 *
 * That is no longer an assumption: `scripts/realtime-probe.ts` proved it against production
 * on 2026-10-06 with named ids — the subscriber received its OWN tenant's rows and never the
 * foreign tenant's, on both an authenticated and an anonymous channel (see
 * docs/audit-2026-10/OPS-VERIFICATION.md section 7).
 *
 * This guard is the defence in depth that outlives that measurement. If a foreign row ever
 * reaches a subscriber, it is an ERROR-level signal and the row must never be rendered — not
 * a redraw and not a silent drop. It lives here, pure and unit-tested, so both components
 * share one definition of "foreign" instead of two copies that can drift.
 */

/** True when this payload carries a row belonging to a DIFFERENT project. */
export function isForeignProjectRow(
  payload: { new?: unknown } | null | undefined,
  projectId: string
): boolean {
  const row = payload?.new as { project_id?: unknown } | undefined;
  // Order ITEMS carry order_id, not project_id — absence of the column means "cannot judge",
  // which must NOT be treated as foreign (that would swallow every item event).
  return typeof row?.project_id === 'string' && row.project_id !== projectId;
}

export const REALTIME_LEAK_MESSAGE = 'REALTIME_TENANT_LEAK: foreign project row delivered';

/** Report a leak without blocking the caller, and name the surface that saw it. */
export function reportRealtimeLeak(surface: string): void {
  void import('@sentry/nextjs').then((Sentry) =>
    Sentry.captureMessage(`${REALTIME_LEAK_MESSAGE} (${surface})`, 'error')
  );
}
