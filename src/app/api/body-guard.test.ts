import { describe, expect, it, vi } from 'vitest';

/**
 * The body guard — 2026-10 audit follow-up, the 12 `request.json()` sites behind a session.
 *
 * `await request.json()` throws on a non-JSON body and on an empty one, so every one of these
 * routes answered 500 and wrote a Sentry event for input nobody validated. The fix is the shape
 * verified on the public order path in W1: read with `.catch(() => null)`, then reject a
 * non-object body with 400.
 *
 * Three handlers are exercised here because they have different dependencies; the other nine
 * share the identical shape and are held by `scripts/check-json-body-guard.mjs` in CI, which
 * fails on ANY route that reads a body without tolerating junk. The tests prove the shape
 * behaves; the gate proves every site has it.
 *
 * The auth layers are mocked and never reached: the guard returns before any database work, so
 * a pass here also means a junk body cannot touch a table.
 */

vi.mock('@/lib/supabase/server', () => ({
  createClient: async () => ({
    auth: {
      getUser: async () => ({ data: { user: { id: 'test-user' } }, error: null }),
      // pos/cancel resolves the caller through getSession() before it reads the body; a mock
      // missing it made the route answer 500 for a reason that had nothing to do with the guard.
      getSession: async () => ({
        data: { session: { user: { id: 'test-user' }, access_token: 't', refresh_token: 'r' } },
        error: null,
      }),
    },
    from: () => {
      throw new Error('the body guard must reject before any table access');
    },
  }),
}));

vi.mock('@/lib/supabase/admin', () => ({
  createAdminClient: () => ({
    from: () => {
      throw new Error('the body guard must reject before any table access');
    },
  }),
}));

import { PUT as staffPrefs } from './staff/notification-prefs/route';
import { POST as posCancel } from './pos/cancel/route';
import { POST as pushUnsubscribe } from './push/unsubscribe/route';

const junk: [string, string][] = [
  ['a non-JSON body', 'not json{'],
  ['an empty body', ''],
  ['a JSON array', '[1,2,3]'],
  ['the literal JSON null', 'null'],
];

// The handler type is pinned: without it TS widens the union of the three routes' signatures
// and every `response` reads as possibly undefined, which is a typing artifact of the table,
// not something the tests should defend against.
type Handler = (req: never) => Promise<Response>;

describe.each<[string, Handler]>([
  ['staff/notification-prefs (PUT)', staffPrefs as unknown as Handler],
  ['pos/cancel (POST)', posCancel as unknown as Handler],
  ['push/unsubscribe (POST)', pushUnsubscribe as unknown as Handler],
])('%s rejects a bad body with 400', (_label, handler) => {
  it.each(junk)('%s -> 400, never 500', async (_case, body) => {
    const request = new Request('http://localhost/api/test', {
      method: 'POST',
      headers: { 'content-type': 'application/json' },
      body,
    });
    const response = await handler(request as never);
    expect(response.status).toBe(400);
    expect(await response.json()).toMatchObject({ error: expect.any(String) });
  });

  it('a well-formed object is NOT rejected by the guard', async () => {
    const request = new Request('http://localhost/api/test', {
      method: 'POST',
      headers: { 'content-type': 'application/json' },
      body: JSON.stringify({ projectId: 'x', endpoint: 'x', orderId: 'x' }),
    });
    // Identified by the guard's OWN message, not by the status code: a route may legitimately
    // answer 400 for a missing field of its own (staff prefs wants projectId + the boolean
    // flags), and asserting "not 400" confused the guard with the route's validation.
    const result = await handler(request as never).catch((e: Error) => e);
    if (result instanceof Error) {
      expect(String(result.message)).toMatch(/before any table access/);
      return;
    }
    const payload = await result.json().catch(() => ({}));
    expect(payload.error).not.toBe('\u0628\u064a\u0627\u0646\u0627\u062a \u063a\u064a\u0631 \u0635\u0627\u0644\u062d\u0629');
  });
});
