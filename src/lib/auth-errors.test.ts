import { describe, expect, it } from 'vitest';
import { classifyAuthError } from '@/lib/auth-errors';

/**
 * Amendment A5 (owner decision 3): an unconfirmed account must be distinguishable from a
 * wrong password, and it must be the ONLY kind that offers a resend control. If this
 * regresses, a merchant is told their password is wrong when their inbox is the problem —
 * and no error path may offer a resend for an address the caller may not own.
 */
describe('classifyAuthError()', () => {
  it('recognises the unconfirmed-account code and offers a resend', () => {
    const out = classifyAuthError({ code: 'email_not_confirmed', status: 400 });
    expect(out.kind).toBe('email_not_confirmed');
    expect(out.canResend).toBe(true);
    expect(out.message).toContain('تأكيد');
  });

  it('recognises the unconfirmed account from the message alone (older GoTrue)', () => {
    const out = classifyAuthError({ message: 'Email not confirmed', status: 400 });
    expect(out.kind).toBe('email_not_confirmed');
    expect(out.canResend).toBe(true);
  });

  it('keeps a genuinely wrong password as invalid_credentials', () => {
    const out = classifyAuthError({ code: 'invalid_credentials', message: 'Invalid login credentials', status: 400 });
    expect(out.kind).toBe('invalid_credentials');
    expect(out.canResend).toBe(false);
    expect(out.message).toBe('بيانات الدخول غير صحيحة');
  });

  it('maps rate limiting to its own message, without a resend control', () => {
    for (const e of [
      { code: 'over_email_send_rate_limit', status: 429 },
      { code: 'over_request_rate_limit', status: 429 },
      { status: 429 },
    ]) {
      const out = classifyAuthError(e);
      expect(out.kind).toBe('rate_limited');
      expect(out.canResend).toBe(false);
    }
  });

  it('maps a weak/same password to the policy message', () => {
    expect(classifyAuthError({ code: 'weak_password' }).kind).toBe('weak_password');
    expect(classifyAuthError({ code: 'same_password' }).kind).toBe('weak_password');
  });

  it('never lets a bare 400 become something other than invalid credentials', () => {
    expect(classifyAuthError({ status: 400 }).kind).toBe('invalid_credentials');
  });

  it('falls back to the safe default for null/undefined/unknown errors', () => {
    for (const e of [null, undefined, {}, { code: 'something_new', status: 500 }]) {
      const out = classifyAuthError(e);
      expect(out.kind).toBe('unknown');
      expect(out.canResend).toBe(false);
      expect(out.message).toBe('بيانات الدخول غير صحيحة');
    }
  });

  it('never returns a raw provider string to the UI', () => {
    const out = classifyAuthError({ code: 'weird_code', message: 'User not found: someone@example.com' });
    expect(out.message).not.toContain('@');
    expect(out.message).not.toMatch(/[A-Za-z]/);
  });

  it('only ONE kind is actionable — resend is never offered for credentials errors', () => {
    const kinds = [
      classifyAuthError({ code: 'email_not_confirmed' }),
      classifyAuthError({ code: 'invalid_credentials' }),
      classifyAuthError({ status: 429 }),
      classifyAuthError({ code: 'weak_password' }),
      classifyAuthError({}),
    ];
    expect(kinds.filter((k) => k.canResend)).toHaveLength(1);
  });

  it('is case-insensitive about the provider code', () => {
    expect(classifyAuthError({ code: 'EMAIL_NOT_CONFIRMED' }).kind).toBe('email_not_confirmed');
  });
});
