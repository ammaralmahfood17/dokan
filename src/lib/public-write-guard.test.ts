import { describe, expect, it } from 'vitest';
import { requireTableToken, TOKEN_RE } from '@/lib/public-write-guard';

const VALID = 'a1b2c3d4e5f60718293a4b5c6d7e8f90';

/**
 * Audit 2026-10-05 (Task 2, finding #1 — CRITICAL).
 *
 * The public order path was authorised by the table SLUG alone (`table-1`), which the
 * storefront page publishes for every active table — so any anonymous caller could inject
 * orders into any active tenant's kitchen. The table's 128-bit scan token existed in the
 * schema the whole time and was never checked.
 *
 * This guard is the single place that decides whether a public write carries proof of a
 * scanned table. It is a pure function precisely so the rule is testable without a DB.
 */
describe('requireTableToken()', () => {
  it('accepts a well-formed 32-hex token', () => {
    expect(requireTableToken(VALID, true)).toEqual({ ok: true, token: VALID });
  });

  it('is case-insensitive — QR scanners upper-case hex', () => {
    expect(requireTableToken(VALID.toUpperCase(), true)).toEqual({ ok: true, token: VALID });
  });

  it('trims surrounding whitespace (copied URLs often carry it)', () => {
    expect(requireTableToken(`  ${VALID}  `, true)).toEqual({ ok: true, token: VALID });
  });

  it('rejects a missing token when enforcing', () => {
    expect(requireTableToken(undefined, true).ok).toBe(false);
  });

  it('rejects the guessable slug used as a token', () => {
    expect(requireTableToken('table-1', true).ok).toBe(false);
  });

  it('rejects a truncated token (31 chars)', () => {
    expect(requireTableToken(VALID.slice(0, 31), true).ok).toBe(false);
  });

  it('rejects an over-long token (33 chars) — no prefix matching', () => {
    expect(requireTableToken(VALID + 'f', true).ok).toBe(false);
  });

  it('rejects non-hex characters of the right length', () => {
    expect(requireTableToken('z'.repeat(32), true).ok).toBe(false);
  });

  it('never treats a non-string as a token', () => {
    expect(requireTableToken({ token: VALID }, true).ok).toBe(false);
    expect(requireTableToken(12345, true).ok).toBe(false);
    expect(requireTableToken(['a'.repeat(32)], true).ok).toBe(false);
  });

  it('returns a 403 with actionable Arabic copy when enforcing', () => {
    const d = requireTableToken(undefined, true);
    expect(d).toMatchObject({ ok: false, status: 403 });
    if (!d.ok) expect(d.error).toContain('QR');
  });

  it('accepts (but does not invent) a token during the rollout window', () => {
    // Printed QR sheets from before the fix carry no token, so enforcement is staged.
    // During the window a tokenless order is accepted AND flagged by the caller, which
    // is how the flip to enforcement is justified with data instead of hope.
    expect(requireTableToken(undefined, false)).toEqual({ ok: true, token: '' });
  });

  it('still normalises a valid token during the rollout window', () => {
    expect(requireTableToken(VALID.toUpperCase(), false)).toEqual({ ok: true, token: VALID });
  });

  it('TOKEN_RE matches exactly 32 hex chars', () => {
    expect(TOKEN_RE.test('f'.repeat(32))).toBe(true);
    expect(TOKEN_RE.test('f'.repeat(31))).toBe(false);
    expect(TOKEN_RE.test('f'.repeat(33))).toBe(false);
  });
});

/**
 * Amendment A6 (2026-10-06) — rollout-window hardening.
 *
 * While REQUIRE_TABLE_TOKEN is false the window accepts a TOKENLESS order (old sheets must
 * keep working). It must NOT accept a SUPPLIED-BUT-WRONG one: treating junk as "no token"
 * would let an attacker sidestep the window's 10/min tokenless budget by padding the field,
 * and no real QR sheet produces a value that fails TOKEN_RE.
 */
describe('requireTableToken() — A6 supplied-but-wrong is always 404', () => {
  const JUNK = ['table-1', 'junk', 'x', VALID.slice(0, 31), VALID + 'f', 'z'.repeat(32)];

  it.each(JUNK)('rejects the malformed token %j with 404, even in the window', (junk) => {
    const d = requireTableToken(junk, false);
    expect(d).toMatchObject({ ok: false, status: 404 });
    expect(d.ok === false && d.error).toContain('رمز');
  });

  it('treats a non-string as malformed, not as tokenless', () => {
    for (const junk of [42, true, { token: VALID }, ['a'.repeat(32)]]) {
      expect(requireTableToken(junk, false)).toMatchObject({ ok: false, status: 404 });
    }
  });

  it('treats whitespace-only as supplied-but-unusable (404), not as absent', () => {
    expect(requireTableToken('   ', false)).toMatchObject({ ok: false, status: 404 });
  });

  it('still accepts a genuinely absent token in the window', () => {
    for (const absent of [undefined, null, '']) {
      expect(requireTableToken(absent, false)).toEqual({ ok: true, token: '' });
    }
  });

  it('hands a well-formed token to the resolver in the window (the RPC decides)', () => {
    // A well-formed token that matches no table is a 404 downstream, from the RPC — not here.
    expect(requireTableToken(VALID, false)).toEqual({ ok: true, token: VALID });
  });

  it('the 404 copy is distinct from the 403 "scan the QR" copy', () => {
    const missing = requireTableToken(undefined, true);
    const malformed = requireTableToken('junk', true);
    if (missing.ok || malformed.ok) throw new Error('expected both decisions to be rejections');
    expect(missing.status).toBe(403);
    expect(malformed.status).toBe(404);
    expect(missing.error).not.toBe(malformed.error);
  });
});
