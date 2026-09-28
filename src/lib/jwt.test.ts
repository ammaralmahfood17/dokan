import { describe, expect, it } from 'vitest';
import { getJwtExpiryMs } from './jwt';

function jwt(payload: Record<string, unknown>) {
  const encoded = Buffer.from(JSON.stringify(payload)).toString('base64url');
  return `header.${encoded}.signature`;
}

describe('getJwtExpiryMs', () => {
  it('returns the expiry in milliseconds', () => {
    expect(getJwtExpiryMs(jwt({ exp: 1_800_000_000 }))).toBe(1_800_000_000_000);
  });

  it('rejects tokens without a finite expiry', () => {
    expect(() => getJwtExpiryMs(jwt({ sub: 'user' }))).toThrow('access token has no expiry');
    expect(() => getJwtExpiryMs(jwt({ exp: 'later' }))).toThrow('access token has no expiry');
  });

  it('rejects malformed tokens', () => {
    expect(() => getJwtExpiryMs('not-a-jwt')).toThrow('invalid access token');
    expect(() => getJwtExpiryMs('a.bad-json.c')).toThrow('invalid access token');
  });
});
