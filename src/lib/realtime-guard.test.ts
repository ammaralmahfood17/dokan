import { describe, expect, it } from 'vitest';
import { REALTIME_LEAK_MESSAGE, isForeignProjectRow } from '@/lib/realtime-guard';

/**
 * Audit T2 #5. The subscriptions carry no project filter, so this predicate is the last line
 * between another tenant's order row and the screen. A false NEGATIVE renders foreign data; a
 * false POSITIVE swallows the tenant's own events (which is what the removed filter did). Both
 * directions are asserted, and the second is why "project_id is absent" must mean "not
 * foreign" rather than "unknown".
 */
const OURS = 'aaaaaaaa-1111-4111-8111-aaaaaaaaaaaa';
const THEIRS = 'bbbbbbbb-2222-4222-8222-bbbbbbbbbbbb';

describe('isForeignProjectRow()', () => {
  it('accepts the project\'s own row', () => {
    expect(isForeignProjectRow({ new: { project_id: OURS } }, OURS)).toBe(false);
  });

  it('flags another tenant\'s row', () => {
    expect(isForeignProjectRow({ new: { project_id: THEIRS } }, OURS)).toBe(true);
  });

  it('does NOT flag an order_items row (no project_id — must not swallow item events)', () => {
    expect(isForeignProjectRow({ new: { order_id: OURS, quantity: 2 } }, OURS)).toBe(false);
  });

  it('does not flag missing/undefined project_id or a non-string value', () => {
    expect(isForeignProjectRow({ new: { project_id: undefined } }, OURS)).toBe(false);
    expect(isForeignProjectRow({ new: { project_id: null } }, OURS)).toBe(false);
    expect(isForeignProjectRow({ new: { project_id: 42 } }, OURS)).toBe(false);
  });

  it('tolerates payloads without a `new` object (DELETE events, empty payloads)', () => {
    expect(isForeignProjectRow({}, OURS)).toBe(false);
    expect(isForeignProjectRow({ new: {} }, OURS)).toBe(false);
    expect(isForeignProjectRow(null, OURS)).toBe(false);
    expect(isForeignProjectRow(undefined, OURS)).toBe(false);
  });

  it('is case/type strict enough to be safe with an empty projectId', () => {
    // An empty id must not match a real row (defensive: a mis-wired prop must not silently
    // accept every tenant's rows as "ours").
    expect(isForeignProjectRow({ new: { project_id: OURS } }, '')).toBe(true);
  });

  it('names the message so ops can alert on it verbatim', () => {
    expect(REALTIME_LEAK_MESSAGE).toBe('REALTIME_TENANT_LEAK: foreign project row delivered');
  });
});
