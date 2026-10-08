/**
 * Canonical origin for this deployment (no trailing slash).
 * Driven by NEXT_PUBLIC_SITE_URL — never by the request Origin header
 * (an attacker controls that and could redirect recovery links).
 * Set it in every environment; localhost is the dev fallback only.
 */
export function getSiteUrl(): string {
  return (
    process.env.NEXT_PUBLIC_SITE_URL?.replace(/\/$/, '') ||
    'http://localhost:3000'
  );
}

/** Host without scheme, e.g. for link previews: "dokan.vercel.app". */
export function getSiteHost(): string {
  return getSiteUrl().replace(/^https?:\/\//, '');
}
