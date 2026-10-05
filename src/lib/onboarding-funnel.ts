import { after } from 'next/server';
import { createAdminClient } from '@/lib/supabase/admin';

/**
 * First-run funnel instrumentation (plan T13).
 *
 * The live product held two signups and one real order, and nothing could say where
 * the other signup stopped — `fofo` created an account, added zero products, and was
 * never seen again. The onboarding checklist knows the answer (it is evaluated on
 * every dashboard load) but the result was rendered and discarded, so the abandonment
 * point was invisible and any fix would have been guesswork.
 *
 * This records the first time each step is OBSERVED as done. Two consequences worth
 * being explicit about:
 *   * It measures "reached, as far as the product can tell", not "clicked a button".
 *     A step counts when its precondition exists in the database (a product row, a
 *     table row, an order), which is the honest definition of the funnel — and it
 *     means the data is retroactive for existing projects.
 *   * A step is only ever recorded as done, never undone. That is deliberate: the
 *     question is whether a merchant got PAST a step, and an un-done flag (e.g. they
 *     deleted their only product) would corrupt the funnel rather than inform it.
 *
 * Best-effort by design. Telemetry must never be able to break the dashboard, so
 * this never throws: a missing migration degrades to "no funnel data", not to a
 * broken page. The write is scheduled with after() so it happens AFTER the response
 * is sent — the dashboard's latency does not include it.
 *
 * Storage is bounded: ON CONFLICT DO NOTHING against the unique (project_id, step)
 * index, so repeat loads are no-ops and the table cannot grow with traffic.
 */
export async function recordOnboardingProgress(
  projectId: string,
  checklist: { id: string; done: boolean }[]
): Promise<void> {
  const reached = checklist.filter((c) => c.done).map((c) => c.id);
  if (reached.length === 0) return;

  after(async () => {
    try {
      const admin = createAdminClient();
      const { error } = await admin
        .from('onboarding_events')
        .upsert(
          reached.map((step) => ({ project_id: projectId, step })),
          { onConflict: 'project_id,step', ignoreDuplicates: true }
        );
      if (error) console.error('onboarding funnel: write failed', error.message);
    } catch (err) {
      console.error('onboarding funnel: write threw', err instanceof Error ? err.message : err);
    }
  });
}
