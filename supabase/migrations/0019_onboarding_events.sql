-- ============================================================================
-- 0019 — first-run funnel instrumentation (why does a signup never come back?)
-- ============================================================================
--
-- OBSERVED (2026-10-05, live): the product has two signups in its whole life and
-- ONE real order between them. `estikana` signed up on 23 Sep and got as far as 7
-- products + 2 tables + 1 order. `fofo` signed up on 28 Sep, was last seen the same
-- day, and created ZERO products and ZERO tables. Nothing in the product could say
-- WHERE it stopped: the onboarding checklist is computed and rendered, then thrown
-- away, so the step a merchant abandons is invisible. Fixing the funnel from that
-- position would be guesswork, and guessing is what this table removes.
--
-- WHAT IT STORES: the first time each onboarding step (see buildChecklist in
-- src/lib/project.ts — product, branding, table, qr, order) is OBSERVED as done for
-- a project. Rows are written from the dashboard, which already evaluates every step
-- on every load — so this needs no client-side beacon and no extra query.
--
-- PRIVACY POSTURE (same as 0015_web_vitals):
--   * project_id and step only. No user id, no email, no IP, no user agent,
--     no referrer, no session.
--   * One row per (project_id, step) — first write wins. The table is therefore
--     bounded by projects x steps; it cannot grow with dashboard visits, and it holds
--     no per-event noise a rollup job would have to trim.
--   * RLS is ON with NO policies: service-role only. A client can neither read nor
--     write it directly, which also means one merchant can never see another's funnel.
--
-- The funnel query this enables (drop-off per step, oldest first):
--   select step, count(*) as projects_reached
--   from public.onboarding_events group by step order by projects_reached desc;
-- ----------------------------------------------------------------------------

CREATE TABLE IF NOT EXISTS public.onboarding_events (
  id bigint GENERATED ALWAYS AS IDENTITY PRIMARY KEY,
  project_id uuid NOT NULL REFERENCES public.projects(id) ON DELETE CASCADE,
  step text NOT NULL,
  created_at timestamptz NOT NULL DEFAULT now(),
  CONSTRAINT onboarding_events_project_step_key UNIQUE (project_id, step)
);

-- The funnel is always asked "how many projects reached this step", i.e. grouped by
-- step over the whole (small) table; the unique index above already serves the
-- per-project write path.
CREATE INDEX IF NOT EXISTS onboarding_events_step_idx
  ON public.onboarding_events (step);

ALTER TABLE public.onboarding_events ENABLE ROW LEVEL SECURITY;

COMMENT ON TABLE public.onboarding_events IS
  'First-run funnel: one row per (project, onboarding step) the first time that step was seen done. Service-role only (RLS on, no policies). No personal data.';
