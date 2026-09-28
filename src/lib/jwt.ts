/** Read the cryptographic expiry from a JWT without treating its claims as trusted. */
export function getJwtExpiryMs(token: string): number {
  const payloadPart = token.split('.')[1];
  if (!payloadPart) throw new Error('invalid access token');

  try {
    const payload = JSON.parse(Buffer.from(payloadPart, 'base64url').toString('utf8')) as {
      exp?: number;
    };
    if (!payload.exp || !Number.isFinite(payload.exp)) {
      throw new Error('access token has no expiry');
    }
    return payload.exp * 1000;
  } catch (error) {
    if (error instanceof Error && error.message === 'access token has no expiry') throw error;
    throw new Error('invalid access token');
  }
}
