import { describe, expect, it } from 'vitest';
import { createServerClient } from '@supabase/ssr';
import {
  AUTH_COOKIE_CHUNK_SIZE,
  authCookieNames,
  clearAuthCookies,
  encodeAuthCookie,
  supabaseProjectRef,
  writeAuthCookie,
} from './impersonation-cookies';

const SUPABASE_URL = 'https://ehbsdfnyetvszjcftaxh.supabase.co';

type Call = { name: string; value: string; maxAge: number };

function jar() {
  const calls: Call[] = [];
  return {
    calls,
    response: {
      cookies: {
        set(name: string, value: string, options: { maxAge: number }) {
          calls.push({ name, value, maxAge: options.maxAge });
        },
      },
    },
  };
}

describe('auth cookie shape', () => {
  it('derives the cookie name from the project ref, not the app hostname', () => {
    expect(supabaseProjectRef(SUPABASE_URL)).toBe('ehbsdfnyetvszjcftaxh');
    expect(authCookieNames(SUPABASE_URL)[0]).toBe('sb-ehbsdfnyetvszjcftaxh-auth-token');
    expect(authCookieNames(SUPABASE_URL)).toHaveLength(6); // base + 5 chunk slots
  });

  it('encodes the way @supabase/ssr reads it (base64- prefix, base64url JSON)', () => {
    const session = { access_token: 'a.b.c', refresh_token: 'non-refreshable-x', user: { id: 'u1' } };
    const encoded = encodeAuthCookie(session);
    expect(encoded.startsWith('base64-')).toBe(true);
    const decoded = JSON.parse(
      Buffer.from(encoded.slice('base64-'.length), 'base64url').toString('utf8')
    );
    expect(decoded).toEqual(session);
    // base64url must be cookie-safe: no padding, no +/ characters.
    expect(encoded).not.toMatch(/[+/=]/);
  });
});

describe('writeAuthCookie', () => {
  it('writes one cookie and caps its life at the support window', () => {
    const { calls, response } = jar();
    writeAuthCookie(response, SUPABASE_URL, { access_token: 'short' }, 900);

    const live = calls.filter((c) => c.maxAge > 0);
    expect(live).toHaveLength(1);
    expect(live[0].name).toBe('sb-ehbsdfnyetvszjcftaxh-auth-token');
    expect(live[0].maxAge).toBe(900);
    // Every slot was expired first so stale chunks cannot resurface.
    expect(calls.filter((c) => c.maxAge === 0)).toHaveLength(6);
  });

  it('chunks a session larger than 3180 chars and round-trips through the chunk join', () => {
    const { calls, response } = jar();
    const session = { access_token: 'x'.repeat(7000), user: { id: 'u1' } };
    writeAuthCookie(response, SUPABASE_URL, session, 900);

    const live = calls.filter((c) => c.maxAge > 0);
    expect(live.length).toBeGreaterThan(1);
    expect(live.every((c) => c.name.startsWith('sb-ehbsdfnyetvszjcftaxh-auth-token.'))).toBe(true);
    expect(live.every((c) => c.value.length <= AUTH_COOKIE_CHUNK_SIZE)).toBe(true);

    const joined = live
      .sort((a, b) => Number(a.name.split('.').pop()) - Number(b.name.split('.').pop()))
      .map((c) => c.value)
      .join('');
    expect(JSON.parse(Buffer.from(joined.slice('base64-'.length), 'base64url').toString('utf8'))).toEqual(
      session
    );
  });

  it('refuses a session that cannot fit in five chunks instead of writing a cookie browsers drop', () => {
    const { response } = jar();
    expect(() =>
      writeAuthCookie(response, SUPABASE_URL, { access_token: 'x'.repeat(AUTH_COOKIE_CHUNK_SIZE * 6) }, 900)
    ).toThrow('too large');
  });
});

describe('clearAuthCookies', () => {
  it('expires the base cookie and every chunk', () => {
    const { calls, response } = jar();
    clearAuthCookies(response, SUPABASE_URL);
    expect(calls).toHaveLength(6);
    expect(calls.every((c) => c.value === '' && c.maxAge === 0)).toBe(true);
  });
});

/**
 * The contract that actually matters: a real @supabase/ssr server client must read back the
 * session this module wrote — both as one cookie and split across chunks. This is the regression
 * test for "API 200 but the browser never logged in".
 */
describe('round-trip through @supabase/ssr', () => {
  function fakeJwt(payload: Record<string, unknown>): string {
    const encode = (value: unknown) => Buffer.from(JSON.stringify(value)).toString('base64url');
    return `${encode({ alg: 'HS256', typ: 'JWT' })}.${encode(payload)}.signature`;
  }

  function browserJar() {
    const store = new Map<string, string>();
    return {
      store,
      response: {
        cookies: {
          set(name: string, value: string, options: { maxAge: number }) {
            if (options.maxAge === 0) store.delete(name);
            else store.set(name, value);
          },
        },
      },
    };
  }

  for (const [label, pad] of [
    ['one cookie', 10],
    ['chunked cookies', 5000],
  ] as const) {
    it(`reads the session back (${label})`, async () => {
      const { store, response } = browserJar();
      const accessToken = fakeJwt({ sub: 'user-1', exp: Math.floor(Date.now() / 1000) + 3600 });
      const session = {
        access_token: accessToken,
        refresh_token: 'non-refreshable-abc',
        token_type: 'bearer',
        expires_in: 900,
        expires_at: Math.floor(Date.now() / 1000) + 3600,
        user: {
          id: 'user-1',
          email: 'owner@example.com',
          user_metadata: { pad: 'x'.repeat(pad) },
        },
      };

      writeAuthCookie(response, SUPABASE_URL, session, 900);
      expect(store.size).toBe(
        Math.ceil(encodeAuthCookie(session).length / AUTH_COOKIE_CHUNK_SIZE)
      );

      const supabase = createServerClient(SUPABASE_URL, 'anon-key', {
        cookies: {
          getAll: () => [...store].map(([name, value]) => ({ name, value })),
          setAll: () => {},
        },
      });

      const { data, error } = await supabase.auth.getSession();
      expect(error).toBeNull();
      expect(data.session?.access_token).toBe(accessToken);
      expect(data.session?.user.id).toBe('user-1');
      expect(data.session?.refresh_token).toBe('non-refreshable-abc');
    });
  }
});
