/**
 * Scan-token scrubber — 2026-10 audit remediation, amendment A2.
 *
 * The public menu URL carries the table's 128-bit scan token in the `k` query parameter
 * (`/…/menu/table-1?k=<32 hex>`). That token is a credential: it authorises ordering at a
 * physical table. Sentry is a THIRD-PARTY system, so a token that reaches an event is a
 * credential leaked off-site — and it can arrive three different ways:
 *
 *   1. `event.request.url` (server/edge events)
 *   2. a breadcrumb's `data.url` / `data.from` / `data.to` / `message`
 *   3. `event.transaction` (the transaction name is often the request path)
 *
 * Ground rule for this codebase: the token must never appear in logs, Sentry events or
 * breadcrumbs, analytics, or Referer headers. This module is the Sentry half; next.config.ts
 * sets `Referrer-Policy: no-referrer` on the menu subtree for the header half.
 *
 * Pure and dependency-free so it can be unit-tested without initialising the SDK.
 */

/** `?k=…` or `&k=…` anywhere in a URL (stops at the next delimiter or whitespace). */
const TOKEN_PARAM = /([?&])k=[^&#\s]*/gi;

const REDACTED = '$1k=REDACTED';

/** Strip the token value from a single string. Cheap early-out for the common case. */
export function scrubTokenFromUrl(value: string): string {
  if (typeof value !== 'string' || value.length === 0) return value;
  if (!value.includes('k=')) return value;
  return value.replace(TOKEN_PARAM, REDACTED);
}

type AnyRecord = Record<string, unknown>;

/** Walk a value, scrubbing every string inside it (breadcrumb data, extra, contexts…). */
function scrubDeep(node: unknown, depth = 0): unknown {
  if (depth > 6) return node; // bound the walk; Sentry payloads are shallow in practice
  if (typeof node === 'string') return scrubTokenFromUrl(node);
  if (Array.isArray(node)) return node.map((item) => scrubDeep(item, depth + 1));
  if (node && typeof node === 'object') {
    const out: AnyRecord = {};
    for (const [key, value] of Object.entries(node as AnyRecord)) {
      out[key] = scrubDeep(value, depth + 1);
    }
    return out;
  }
  return node;
}

/** Scrub one breadcrumb (message + data). Returns the same object, mutated in place. */
export function scrubSentryBreadcrumb<B>(breadcrumb: B): B {
  const crumb = breadcrumb as unknown as AnyRecord;
  if (typeof crumb.message === 'string') crumb.message = scrubTokenFromUrl(crumb.message);
  if (crumb.data) crumb.data = scrubDeep(crumb.data);
  return breadcrumb;
}

/**
 * Scrub a Sentry event in place: request URL + headers, transaction name, breadcrumbs, and
 * the free-form `extra` / `tags` / `contexts` bags. Mutating in place matches what these
 * hooks already do (the existing ones `delete` PII fields).
 */
export function scrubSentryEvent<E>(event: E): E {
  const e = event as unknown as AnyRecord;

  const request = e.request as AnyRecord | undefined;
  if (request && typeof request === 'object') {
    if (typeof request.url === 'string') request.url = scrubTokenFromUrl(request.url);
    if (typeof request.query_string === 'string') {
      request.query_string = scrubTokenFromUrl(request.query_string);
    }
    if (request.headers) request.headers = scrubDeep(request.headers) as AnyRecord;
  }

  if (typeof e.transaction === 'string') e.transaction = scrubTokenFromUrl(e.transaction);
  if (typeof e.message === 'string') e.message = scrubTokenFromUrl(e.message);

  if (Array.isArray(e.breadcrumbs)) {
    e.breadcrumbs = e.breadcrumbs.map((crumb) => scrubSentryBreadcrumb(crumb));
  }

  for (const bag of ['extra', 'tags', 'contexts'] as const) {
    if (e[bag]) e[bag] = scrubDeep(e[bag]);
  }

  return event;
}
