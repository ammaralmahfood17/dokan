import { describe, it, expect } from 'vitest';
import {
  compositeOver,
  contrastRatio,
  parseHex,
  relativeLuminance,
  resolveLegibleFill,
} from './contrast';

/**
 * Guards for the tenant-fill resolver (audit F-3).
 *
 * The numbers below are the ones that were MEASURED on the live tenants before the fix:
 *   #FFFFFF on #F4A4C0 = 1.92:1   (fofo's store name — axe SERIOUS)
 *   #FCE4EC on #F5ADC6 = 1.52:1   (its closed-store line)
 *   #FFFFFF on #7047EB = 5.54:1   (the platform's own brand fill, already fine)
 * A regression here is a customer unable to read a store's name, so the assertions name the
 * tenant colours explicitly rather than only testing synthetic greys.
 */
describe('contrast maths', () => {
  it('parses and rejects hex in the shapes the app passes', () => {
    expect(parseHex('#fff')).toEqual({ r: 255, g: 255, b: 255 });
    expect(parseHex('7047EB')).toEqual({ r: 112, g: 71, b: 235 });
    expect(parseHex('#F4A4C080')).toEqual({ r: 244, g: 164, b: 192 });
    expect(parseHex('not-a-colour')).toBeNull();
    expect(parseHex('#12345')).toBeNull();
  });

  it('matches the WCAG reference values', () => {
    expect(contrastRatio('#FFFFFF', '#000000')).toBeCloseTo(21, 1);
    expect(contrastRatio('#FFFFFF', '#FFFFFF')).toBeCloseTo(1, 5);
    // measured live on the platform brand fill
    expect(contrastRatio('#FFFFFF', '#7047EB')).toBeCloseTo(5.54, 1);
  });

  it('composites an alpha colour over its backdrop before comparing', () => {
    // white at 70% over the brand violet is the exact pair axe flagged at 3.54:1 on the landing hero
    const blended = compositeOver('#FFFFFF', 0.7, '#7047EB');
    expect(contrastRatio(blended, '#7047EB')).toBeLessThan(4.5);
    // 90% is the first passing step — the whole reason the hero uses /90
    expect(contrastRatio(compositeOver('#FFFFFF', 0.9, '#7047EB'), '#7047EB')).toBeGreaterThanOrEqual(4.5);
  });
});

describe('resolveLegibleFill', () => {
  it('leaves the platform brand fill alone and keeps white ink', () => {
    const r = resolveLegibleFill('#7047EB');
    expect(r.fill).toBe('#7047EB');
    expect(r.ink).toBe('#FFFFFF');
    expect(r.deepened).toBe(0);
    expect(r.ratio).toBeGreaterThanOrEqual(4.5);
  });

  it('fofo (#F4A4C0): keeps the hue, picks the dark ink, and every ink clears the bar', () => {
    const r = resolveLegibleFill('#F4A4C0');
    expect(r.deepened).toBe(0); // no need to repaint a colour that a dark ink can carry
    expect(r.ink).not.toBe('#FFFFFF');
    expect(r.ratio).toBeGreaterThanOrEqual(4.5);
    // the quiet step must ALSO clear the bar — 4.5 is the floor for small text, not a target
    expect(r.mutedRatio).toBeGreaterThanOrEqual(4.5);
    expect(contrastRatio(r.inkMuted, r.fill)).toBeGreaterThanOrEqual(4.5);
    // the old pair, for the record: this is what the customer used to get
    expect(contrastRatio('#FFFFFF', '#F4A4C0')).toBeLessThan(2.5);
  });

  it('deepens a mid-blue at constant hue when neither ink passes', () => {
    const r = resolveLegibleFill('#3B82F6');
    expect(r.ratio).toBeGreaterThanOrEqual(4.5);
    expect(r.deepened).toBeGreaterThan(0);
    // hue held: still blue, not grey or black
    const [hr] = [r.fill];
    expect(hr).toMatch(/^#[0-9A-F]{6}$/);
    const f = parseHex(r.fill)!;
    expect(f.b).toBeGreaterThan(f.r);
    expect(relativeLuminance(r.fill)).toBeLessThan(relativeLuminance('#3B82F6'));
  });

  it('never returns ink that fails the floor, for any tenant colour', () => {
    const samples = ['#F4A4C0', '#F5ADC6', '#FF9B53', '#FF698F', '#E23B7B', '#A244FF', '#FFFFFF', '#000000', '#FAF9F6'];
    for (const brand of samples) {
      const r = resolveLegibleFill(brand);
      expect(contrastRatio(r.ink, r.fill), `${brand} ink`).toBeGreaterThanOrEqual(4.5);
      expect(contrastRatio(r.inkMuted, r.fill), `${brand} muted`).toBeGreaterThanOrEqual(4.5);
      expect(parseHex(r.fill), `${brand} fill`).not.toBeNull();
    }
  });

  it('guarantees the quiet ink on the surface it is painted on, not just on the fill', () => {
    // The /fofo storefront regression, pinned: a secondary line in `inkMuted` on an `inkSoft`
    // panel measured 3.70:1 on production while `mutedRatio` said 4.79:1 — because the ratio was
    // measured against `fill` and the text sat on the darker `inkSoft`. Every colour the resolver
    // hands out must clear the bar against the surface whose name it carries.
    const samples = ['#F4A4C0', '#F5ADC6', '#FF9B53', '#FF698F', '#E23B7B', '#A244FF', '#3B82F6', '#FFFFFF', '#000000'];
    for (const brand of samples) {
      const r = resolveLegibleFill(brand);
      expect(contrastRatio(r.inkMutedSoft, r.inkSoft), `${brand} inkMutedSoft/inkSoft`).toBeGreaterThanOrEqual(4.5);
      expect(r.mutedSoftRatio).toBeGreaterThanOrEqual(4.5);
      expect(contrastRatio(r.ink, r.inkSoft), `${brand} ink/inkSoft`).toBeGreaterThanOrEqual(4.5);
    }
    // and the specific pair that was broken, kept as the regression's own evidence
    const fofo = resolveLegibleFill('#F4A4C0');
    expect(contrastRatio(fofo.inkMuted, fofo.inkSoft)).toBeLessThan(4.5);
    expect(contrastRatio(fofo.inkMutedSoft, fofo.inkSoft)).toBeGreaterThanOrEqual(4.5);
  });

  it('falls back to the platform brand for junk or missing input', () => {
    for (const bad of [null, undefined, '', 'hotpink', '#12']) {
      const r = resolveLegibleFill(bad as string | null | undefined);
      expect(r.fill).toBe('#7047EB');
      expect(r.ratio).toBeGreaterThanOrEqual(4.5);
    }
  });
});
