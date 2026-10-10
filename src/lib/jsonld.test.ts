import { renderToStaticMarkup } from 'react-dom/server';
import React from 'react';
import { describe, expect, it } from 'vitest';
import { buildRestaurantJsonLd, serializeJsonLd } from './jsonld';

/**
 * Audit T1 #5 — the structured data on the public menu was not structured data.
 *
 * The first test does not describe the FIX, it describes the BUG, and it is kept on purpose: it is
 * the evidence that the old shape cannot work, so nobody re-introduces a `jsonLd` prop by copying
 * the old line back out of git history. If a future React ever adds the prop, this test fails and
 * says so.
 */
describe('JSON-LD emission (audit T1 #5)', () => {
  it('a `jsonLd` PROP produces an attribute, never a JSON-LD body (the shipped bug)', () => {
    const html = renderToStaticMarkup(
      React.createElement('script', {
        type: 'application/ld+json',
        jsonLd: { '@context': 'https://schema.org', '@type': 'Restaurant' },
      } as never)
    );
    expect(html).not.toContain('schema.org');
    // The exact mechanism, so the finding is documented by the assertion rather than by a comment:
    expect(html).toContain('jsonLd="[object Object]"');
  });

  it('the builder produces a serialisable Restaurant document', () => {
    const ld = buildRestaurantJsonLd({
      name: '\u0627\u0633\u062a\u0643\u0627\u0646\u0629',
      url: 'https://dokanstore.xyz/estikana',
    });
    expect(ld['@context']).toBe('https://schema.org');
    expect(ld['@type']).toBe('Restaurant');
    expect(ld.name).toBe('\u0627\u0633\u062a\u0643\u0627\u0646\u0629');
    expect(ld.url).toBe('https://dokanstore.xyz/estikana');
    expect(ld.servesCuisine).toBe('Gulf');
    // Round-tripping is the property the route depends on: JSON.stringify is what the browser gets.
    expect(JSON.parse(JSON.stringify(ld))).toEqual(ld);
  });

  it('omits `image` when the store has none (no undefined key in the payload)', () => {
    expect('image' in buildRestaurantJsonLd({ name: 'X', url: 'https://x.test/x' })).toBe(false);
    expect(buildRestaurantJsonLd({ name: 'X', url: 'https://x.test/x', image: null })).not.toHaveProperty('image');
    expect(buildRestaurantJsonLd({ name: 'X', url: 'https://x.test/x', image: 'https://x.test/l.png' }).image)
      .toBe('https://x.test/l.png');
  });

  it('rendering it the way the page does yields a parseable JSON-LD body', () => {
    const html = renderToStaticMarkup(
      React.createElement('script', {
        type: 'application/ld+json',
        dangerouslySetInnerHTML: {
          __html: serializeJsonLd(buildRestaurantJsonLd({ name: 'X', url: 'https://x.test/x' })),
        },
      })
    );
    const body = html.replace(/^<script[^>]*>/, '').replace(/<\/script>$/, '');
    expect(html).toContain('type="application/ld+json"');
    expect(() => JSON.parse(body)).not.toThrow();
    expect(JSON.parse(body)).toMatchObject({ '@type': 'Restaurant', name: 'X' });
  });

  /**
   * Bug hunt 2026-10-10 — stored XSS. `JSON.stringify` leaves `<` alone, so a store NAME closing
   * the tag turned the rest of the payload into live markup for every customer who scanned that
   * table's QR, and the production CSP allows inline scripts. The assertion is the invariant that
   * matters: exactly ONE `<script` in the rendered output, and the hostile name still round-trips
   * through a JSON parser unchanged.
   */
  it('escapes `<` so a store name cannot close the script tag (stored XSS)', () => {
    const hostile = '</script><script>window.__PWNED=1</script>';
    const html = renderToStaticMarkup(
      React.createElement('script', {
        type: 'application/ld+json',
        dangerouslySetInnerHTML: {
          __html: serializeJsonLd(buildRestaurantJsonLd({ name: hostile, url: 'https://x.test/x' })),
        },
      })
    );
    expect((html.match(/<script/g) ?? []).length).toBe(1);
    expect(html).not.toContain('<script>window.__PWNED');
    expect(html).toContain('\\u003c/script>');
    const body = html.replace(/^<script[^>]*>/, '').replace(/<\/script>$/, '');
    expect(JSON.parse(body).name).toBe(hostile);
  });

  it('serializeJsonLd keeps ordinary payloads byte-identical to JSON.stringify', () => {
    const ld = buildRestaurantJsonLd({ name: 'استكانة', url: 'https://dokanstore.xyz/estikana' });
    expect(serializeJsonLd(ld)).toBe(JSON.stringify(ld));
  });
});
