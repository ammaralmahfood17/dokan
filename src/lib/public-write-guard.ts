/**
 * Public write gate — audit 2026-10-05 (Task 2, finding #1, CRITICAL).
 *
 * A public order must prove WHICH table it belongs to using the 128-bit scan token printed
 * in that table's QR code (`tables.qrcode`, uniquely indexed, unreadable by `anon`).
 * The table slug alone is guessable AND is published by the storefront page
 * (`/[projectSlug]` links every active table), so it can never authorise a write.
 *
 * Why the rollout switch instead of a hard requirement from day one: QR sheets printed
 * before the fix do not carry the token, and breaking every existing sheet would stop real
 * customers from ordering. While `REQUIRE_TABLE_TOKEN` is off, a tokenless order is still
 * accepted — but the route records `token_present: false` in the order audit log and emits a
 * Sentry warning, which is how the flip is justified with data instead of hope.
 *
 * Pure and dependency-free on purpose: this is the rule that closes a Critical, so it is
 * unit-tested (see public-write-guard.test.ts) rather than only exercised through the route.
 */

/** 128 bits, lowercase hex — the shape `tables.qrcode` is generated in. */
export const TOKEN_RE = /^[0-9a-f]{32}$/;

/** The message a customer sees when their link has no usable token. */
export const MISSING_TOKEN_ERROR =
  'امسح رمز الطاولة (QR) لتأكيد طلبك — الرمز موجود على طاولتك';

export type TokenDecision =
  | { ok: true; token: string }
  | { ok: false; status: 403; error: string };

/**
 * Validate the caller-supplied table scan token.
 *
 * @param rawToken  whatever arrived in the request body (any JSON type)
 * @param enforce   `REQUIRE_TABLE_TOKEN === 'true'` at the call site; injected so the
 *                  decision is testable without touching process.env
 */
export function requireTableToken(
  rawToken: unknown,
  enforce: boolean = process.env.REQUIRE_TABLE_TOKEN === 'true'
): TokenDecision {
  const token = typeof rawToken === 'string' ? rawToken.trim().toLowerCase() : '';

  if (TOKEN_RE.test(token)) return { ok: true, token };

  // Rollout window: accept a tokenless order, but return an EMPTY token (never the raw
  // value), so the route records the absence instead of silently pretending it matched.
  if (!enforce) return { ok: true, token: '' };

  return { ok: false, status: 403, error: MISSING_TOKEN_ERROR };
}
