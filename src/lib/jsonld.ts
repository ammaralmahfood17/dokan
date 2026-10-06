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
