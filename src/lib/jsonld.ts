/**
 * Restaurant structured data — audit T1 #5.
 *
 * The storefront shipped this as a `jsonLd` PROP on a `<script>`:
 *
 *   <script type="application/ld+json" {...({ jsonLd: { … } } as object)} />
 *
 * React 19 has no such prop (and @types/react does not define it either - the `as object` cast is
 * what silenced the compiler). It renders the prop as an ATTRIBUTE, so the page carried
 * `jsonLd="[object Object]"` and no JSON-LD document at all, which is why Google saw nothing.
 *
 * A tiny builder rather than an inline literal, because the tracker requires a covering test per
 * finding and this is the smallest unit that can carry one.
 */

export type RestaurantInput = {
  name: string;
  url: string;
  /** Optional: a store without a logo must not emit an `image: undefined` key. */
  image?: string | null;
};

export type RestaurantJsonLd = {
  '@context': 'https://schema.org';
  '@type': 'Restaurant';
  name: string;
  url: string;
  servesCuisine: string;
  image?: string;
};

export function buildRestaurantJsonLd({ name, url, image }: RestaurantInput): RestaurantJsonLd {
  return {
    '@context': 'https://schema.org',
    '@type': 'Restaurant',
    name,
    url,
    servesCuisine: 'Gulf',
    ...(image ? { image } : {}),
  };
}

/**
 * Serialize structured data for a `<script type="application/ld+json">` body.
 *
 * `JSON.stringify` does NOT escape `<`, so a merchant-controlled value (the store name, which the
 * owner types during onboarding) containing `</script><script>…` closed the tag and executed the
 * rest as markup — stored XSS on every customer who scanned that table's QR, and the live CSP
 * (`script-src 'self' 'unsafe-inline'`) does not stop inline payloads. Escaping `<` as `\u003c`
 * is invisible to a JSON parser (`JSON.parse` returns the original string) and makes a breakout
 * impossible. Reproduced before the fix by rendering this snippet: 2 `<script` tags in the output.
 */
export function serializeJsonLd(value: unknown): string {
  return JSON.stringify(value).replace(/</g, '\\u003c');
}
