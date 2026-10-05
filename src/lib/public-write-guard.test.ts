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
