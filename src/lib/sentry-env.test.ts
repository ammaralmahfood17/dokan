import { describe, expect, it } from 'vitest';
import { shouldEnableSentry } from '@/lib/sentry-env';

/**
 * Sentry used to initialise wherever a DSN was present, so every local `next start`
 * on this box reported as environment=development — 90 `Error: aborted` events from
 * http://localhost:3101/api/vitals ended up in the project's unresolved list.
 * These cases pin the gate: a real Vercel deployment reports, a local run does not.
 */
describe('shouldEnableSentry()', () => {
  it('reports from production', () => {
    expect(shouldEnableSentry('production')).toBe(true);
  });

  it('reports from preview deployments', () => {
    expect(shouldEnableSentry('preview')).toBe(true);
  });

  it('stays off when VERCEL_ENV is absent (local dev/start)', () => {
    expect(shouldEnableSentry(undefined)).toBe(false);
  });

  it('stays off for Vercel development builds', () => {
    expect(shouldEnableSentry('development')).toBe(false);
  });

  it('honours the explicit local opt-in', () => {
    expect(shouldEnableSentry(undefined, 'true')).toBe(true);
  });

  it('ignores a non-"true" opt-in value', () => {
    expect(shouldEnableSentry(undefined, '1')).toBe(false);
  });
});
