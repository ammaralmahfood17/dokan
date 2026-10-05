import { describe, expect, it } from 'vitest';
import {
  MIN_PASSWORD_LENGTH,
  MAX_PASSWORD_LENGTH,
  validateNewPassword,
} from '@/lib/password-policy';

/**
 * Audit 2026-10-05 (Task 2, finding #2). The signup route creates users with the
 * service-role admin API, which skips GoTrue's validation entirely — so these unit tests
 * are the only thing standing between "policy" and "someone can 1-char their way in".
 */
describe('validateNewPassword()', () => {
  const good = 'Dokan2026Aa';

  it('accepts a password meeting the policy', () => {
    expect(validateNewPassword(good)).toEqual({ ok: true });
  });

  it('rejects anything shorter than the floor', () => {
    for (const pw of ['aA1', 'Short1Aa', 'NineChars'.slice(0, 9) + '1'.replace('1', '')]) {
      expect(validateNewPassword(pw).ok).toBe(false);
    }
  });

  it('rejects a 9-char password and accepts 10 — the exact boundary', () => {
    expect(validateNewPassword('Abcdefg1x').ok).toBe(false);
    expect(validateNewPassword('Abcdefg1xy').ok).toBe(true);
  });

  it('rejects the bcrypt-truncation risk above 72 chars', () => {
    expect(validateNewPassword('Aa1' + 'x'.repeat(MAX_PASSWORD_LENGTH)).ok).toBe(false);
  });

  it('rejects an all-lowercase password of sufficient length', () => {
    expect(validateNewPassword('abcdefghij').ok).toBe(false);
  });

  it('rejects a digits-only password', () => {
    expect(validateNewPassword('1234567890').ok).toBe(false);
  });

  it('rejects an all-UPPERCASE password of sufficient length', () => {
    expect(validateNewPassword('ABCDEFGHIJ').ok).toBe(false);
  });

  it('rejects a letters-only password with no digit', () => {
    expect(validateNewPassword('Abcdefghij').ok).toBe(false);
  });

  it('rejects a password missing lowercase', () => {
    expect(validateNewPassword('ABCDEFGHI1').ok).toBe(false);
  });

  it('the three classes are a CONJUNCTION — dropping any one fails', () => {
    expect(validateNewPassword('Abcdefghi1').ok).toBe(true);
    expect(validateNewPassword('abcdefghi1').ok).toBe(false); // no uppercase
    expect(validateNewPassword('ABCDEFGHI1').ok).toBe(false); // no lowercase
    expect(validateNewPassword('Abcdefghij').ok).toBe(false); // no digit
  });

  it('rejects non-strings without throwing (JSON bodies can carry null/objects)', () => {
    for (const bad of [null, undefined, 12345678901, {}, ['Aa1abcdefgh']]) {
      expect(validateNewPassword(bad).ok).toBe(false);
    }
  });

  it('the floor is the documented value', () => {
    expect(MIN_PASSWORD_LENGTH).toBe(10);
  });
});
