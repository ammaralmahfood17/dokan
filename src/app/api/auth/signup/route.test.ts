import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

/**
 * POST /api/auth/signup — 2026-10 audit remediation, amendment A5.
 *
 * A5 asks for tests on the payload rules the route actually enforces: password policy
 * (min 10, lower+upper+digit), fullName type and length, and the unconfirmed-account flow.
 * Until now a fullName of the wrong TYPE was only covered by reading the code.
 *
 * The DB and the network are mocked: this suite is about the route's own decisions, and it
 * must never create a real account (a live account created from a test is a live account to
 * clean up).
 */

const createUser = vi.fn();
const resend = vi.fn();

vi.mock('@/lib/rate-limit', () => ({
  rateLimit: vi.fn(async () => ({ allowed: true, remaining: 9, resetIn: 60_000 })),
  createRateLimitResponse: (resetIn: number) => ({ error: `rate ${resetIn}`, status: 429 }),
}));

vi.mock('@/lib/supabase/admin', () => ({
  createAdminClient: () => ({ auth: { admin: { createUser } } }),
}));

vi.mock('@/lib/supabase/anon', () => ({
  createAnonClient: () => ({ auth: { resend } }),
}));

import { POST } from '@/app/api/auth/signup/route';

function post(body: string) {
  return POST(
    new Request('http://localhost/api/auth/signup', {
      method: 'POST',
      headers: { 'content-type': 'application/json' },
      body,
    })
  );
}

function json(payload: unknown) {
  return post(JSON.stringify(payload));
}

const VALID = {
  email: 'Merchant@Example.com',
  password: 'Dokan2026Aa',
  fullName: 'عمار باقر',
};

beforeEach(() => {
  createUser.mockReset();
  createUser.mockResolvedValue({ data: { user: { id: 'user-1', email: 'merchant@example.com' } }, error: null });
  resend.mockReset();
  resend.mockResolvedValue({ error: null });
  vi.stubEnv('TURNSTILE_SECRET', '');
  vi.stubEnv('VERCEL_ENV', '');
  vi.stubEnv('NODE_ENV', 'test');
});

afterEach(() => {
  vi.unstubAllEnvs();
});

describe('payload shape', () => {
  it('rejects a non-JSON body with 400, never a 500', async () => {
    const res = await post('not-json-at-all');
    expect(res.status).toBe(400);
    expect(createUser).not.toHaveBeenCalled();
  });

  it('rejects JSON null and JSON array with 400', async () => {
    expect((await post('null')).status).toBe(400);
    expect((await post('[]')).status).toBe(400);
    expect(createUser).not.toHaveBeenCalled();
  });

  it('rejects a missing email or password', async () => {
    expect((await json({ password: VALID.password, fullName: VALID.fullName })).status).toBe(400);
    expect((await json({ email: VALID.email, fullName: VALID.fullName })).status).toBe(400);
  });

  it('rejects a malformed or non-string email', async () => {
    for (const email of ['nope', 'a@b', 'a b@c.d', 42, null]) {
      const res = await json({ ...VALID, email });
      expect(res.status, `email=${String(email)}`).toBe(400);
    }
    expect(createUser).not.toHaveBeenCalled();
  });
});

describe('fullName type and length (A5)', () => {
  it('rejects a non-string fullName — a number, an object, an array, null', async () => {
    for (const fullName of [42, { name: 'x' }, ['عمار'], null, undefined, true]) {
      const res = await json({ ...VALID, fullName });
      expect(res.status, `fullName=${JSON.stringify(fullName)}`).toBe(400);
    }
    expect(createUser).not.toHaveBeenCalled();
  });

  it('rejects a fullName shorter than 2 characters after trimming', async () => {
    for (const fullName of ['ع', ' ', '  x  '.slice(0, 3)]) {
      const res = await json({ ...VALID, fullName });
      expect(res.status, `fullName=${JSON.stringify(fullName)}`).toBe(400);
    }
  });

  it('rejects a fullName longer than 80 characters', async () => {
    const res = await json({ ...VALID, fullName: 'ا'.repeat(81) });
    expect(res.status).toBe(400);
    expect(createUser).not.toHaveBeenCalled();
  });

  it('accepts exactly 2 characters and exactly 80 characters', async () => {
    for (const fullName of ['عا', 'ا'.repeat(80)]) {
      const res = await json({ ...VALID, fullName });
      expect(res.status, `len=${fullName.length}`).toBe(200);
    }
  });
});

describe('password policy at the route boundary (min 10, lower+upper+digit)', () => {
  const rejected = [
    ['too short (9)', 'Abcdefg1x'],
    ['no uppercase', 'abcdefghi1'],
    ['no lowercase', 'ABCDEFGHI1'],
    ['no digit', 'Abcdefghij'],
  ] as const;

  it.each(rejected)('rejects %s with 400', async (_label, password) => {
    const res = await json({ ...VALID, password });
    expect(res.status).toBe(400);
    expect(createUser).not.toHaveBeenCalled();
  });

  it('rejects over 72 characters (bcrypt truncation)', async () => {
    const res = await json({ ...VALID, password: 'Aa1' + 'x'.repeat(72) });
    expect(res.status).toBe(400);
  });

  it('accepts a policy-compliant password', async () => {
    expect((await json(VALID)).status).toBe(200);
  });
});

describe('Turnstile at the route boundary (A5, decisions 7/8)', () => {
  it('REFUSES with 503 and creates nothing when production has no secret', async () => {
    vi.stubEnv('VERCEL_ENV', 'production');
    const res = await json({ ...VALID, turnstileToken: 'x' });
    expect(res.status).toBe(503);
    expect(createUser).not.toHaveBeenCalled();
  });

  it('never creates an account when a configured Turnstile rejects the token', async () => {
    vi.stubEnv('VERCEL_ENV', '');
    vi.stubEnv('TURNSTILE_SECRET', 'a-secret');
    const fetchSpy = vi
      .spyOn(globalThis, 'fetch')
      .mockResolvedValue(new Response(JSON.stringify({ success: false }), { status: 200 }));
    try {
      const res = await json({ ...VALID, turnstileToken: 'bad-token' });
      expect(res.status).toBe(400);
      expect(createUser).not.toHaveBeenCalled();
    } finally {
      fetchSpy.mockRestore();
    }
  });
});

describe('the created account is UNCONFIRMED (decision 7)', () => {
  it('creates with email_confirm false, then sends the confirmation mail', async () => {
    const res = await json(VALID);
    expect(res.status).toBe(200);

    expect(createUser).toHaveBeenCalledTimes(1);
    const arg = createUser.mock.calls[0][0] as { email: string; email_confirm: boolean };
    expect(arg.email_confirm).toBe(false);
    // The address is normalised before it reaches Auth, so the confirmation mail and the
    // login form cannot disagree about which account they mean.
    expect(arg.email).toBe('merchant@example.com');
    expect(resend).toHaveBeenCalledWith({ type: 'signup', email: 'merchant@example.com' });

    const body = (await res.json()) as { needsConfirmation?: boolean; emailSent?: boolean };
    expect(body.needsConfirmation).toBe(true);
    expect(body.emailSent).toBe(true);
  });

  it('reports honestly when the confirmation mail could not be sent', async () => {
    resend.mockResolvedValue({ error: { message: 'Error sending confirmation email' } });
    const res = await json(VALID);
    expect(res.status).toBe(200);
    const body = (await res.json()) as { emailSent?: boolean; message?: string };
    expect(body.emailSent).toBe(false);
    expect(body.message).toContain('تعذّر');
  });

  it('does not leak the provider error to the client', async () => {
    createUser.mockResolvedValue({
      data: { user: null },
      error: { message: 'User already registered: merchant@example.com' },
    });
    const res = await json(VALID);
    expect(res.status).toBe(400);
    const text = JSON.stringify(await res.json());
    expect(text).not.toContain('merchant@example.com');
    expect(text).not.toContain('already registered');
  });
});
