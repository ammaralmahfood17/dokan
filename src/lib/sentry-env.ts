/**
 * Whether this process should report to Sentry at all.
 *
 * WHY (2026-10-18): the SDK was initialised wherever a DSN existed, so every local
 * `next dev`/`next start` on this box reported as environment=development. Those
 * events are noise — all 90 `Error: aborted` reports in the project came from
 * http://localhost:3101/api/vitals (a client disconnect against a local server),
 * and they sat in the unresolved list next to real production issues.
 *
 * Rule: report only from a real deployment. Vercel sets VERCEL_ENV for every build
 * (server/edge) and NEXT_PUBLIC_VERCEL_ENV for the browser bundle; a local run has
 * neither. `SENTRY_ENABLE_DEV=true` is the explicit opt-in for someone deliberately
 * testing the Sentry wiring from a development machine.
 *
 * Kept argument-driven (no `process.env` here) so the browser bundle never pulls
 * server variables and so the decision is testable without touching the environment.
 */
export function shouldEnableSentry(
  vercelEnv: string | undefined,
  optIn?: string
): boolean {
  if (optIn === 'true') return true;
  return vercelEnv === 'production' || vercelEnv === 'preview';
}
