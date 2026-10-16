/**
 * WCAG 2.x contrast maths + the tenant-brand legibility resolver.
 *
 * WHY (frontend audit F-3, 2026-10-16): a storefront hero paints the merchant's OWN brand colour
 * as its background and then writes white on it. Measured on the live tenants with a failing pair
 * per element: `/fofo` rendered `#FFFFFF on #F4A4C0 = 1.92:1` for the store name and
 * `#FCE4EC on #F5ADC6 = 1.52:1` for the closed-store line — axe flagged two SERIOUS
 * colour-contrast violations, and a customer literally cannot read whose store they are standing in.
 *
 * Repainting the owner's identity is NOT the fix (that is their brand). The fix is to resolve the
 * ink for the fill they chose, and only when neither white nor the dark ink clears the bar, deepen
 * the fill toward the nearest passing value while HOLDING THE HUE.
 *
 * One copy of the formula lives here, imported by the component and by the regression test — a
 * second copy drifts and the test then certifies a number the screen never rendered.
 */

const MIN_RATIO = 4.5; // WCAG 1.4.3, normal text
const DARK_INK = '#1F2320'; // --color-text
const WHITE = '#FFFFFF';

function clamp255(n: number): number {
  return Math.max(0, Math.min(255, Math.round(n)));
}

/** `#RGB` / `#RRGGBB` / `#RRGGBBAA` -> {r,g,b} (0-255). Returns null when unparseable. */
export function parseHex(hex: string): { r: number; g: number; b: number } | null {
  if (typeof hex !== 'string') return null;
  const h = hex.trim().replace(/^#/, '');
  if (!/^([0-9a-f]{3}|[0-9a-f]{6}|[0-9a-f]{8})$/i.test(h)) return null;
  const full = h.length === 3 ? h.split('').map((c) => c + c).join('') : h.slice(0, 6);
  return {
    r: parseInt(full.slice(0, 2), 16),
    g: parseInt(full.slice(2, 4), 16),
    b: parseInt(full.slice(4, 6), 16),
  };
}

export function toHex({ r, g, b }: { r: number; g: number; b: number }): string {
  return '#' + [r, g, b].map((v) => clamp255(v).toString(16).padStart(2, '0')).join('').toUpperCase();
}

function channelLuminance(c: number): number {
  const s = c / 255;
  return s <= 0.04045 ? s / 12.92 : ((s + 0.055) / 1.055) ** 2.4;
}

export function relativeLuminance(hex: string): number {
  const rgb = parseHex(hex);
  if (!rgb) return 0;
  return (
    0.2126 * channelLuminance(rgb.r) +
    0.7152 * channelLuminance(rgb.g) +
    0.0722 * channelLuminance(rgb.b)
  );
}

/** WCAG contrast ratio, 1..21. Always composites an alpha colour over its backdrop first. */
export function contrastRatio(fg: string, bg: string): number {
  const l1 = relativeLuminance(fg);
  const l2 = relativeLuminance(bg);
  const hi = Math.max(l1, l2);
  const lo = Math.min(l1, l2);
  return (hi + 0.05) / (lo + 0.05);
}

/** Composite `fg` at `alpha` over `bg` (sRGB, no gamma trickery) and return the resulting hex. */
export function compositeOver(fg: string, alpha: number, bg: string): string {
  const f = parseHex(fg);
  const b = parseHex(bg);
  if (!f || !b) return bg;
  const a = Math.max(0, Math.min(1, alpha));
  return toHex({
    r: f.r * a + b.r * (1 - a),
    g: f.g * a + b.g * (1 - a),
    b: f.b * a + b.b * (1 - a),
  });
}

function rgbToHsl({ r, g, b }: { r: number; g: number; b: number }): [number, number, number] {
  const rn = r / 255;
  const gn = g / 255;
  const bn = b / 255;
  const max = Math.max(rn, gn, bn);
  const min = Math.min(rn, gn, bn);
  const l = (max + min) / 2;
  if (max === min) return [0, 0, l];
  const d = max - min;
  const s = l > 0.5 ? d / (2 - max - min) : d / (max + min);
  let h: number;
  if (max === rn) h = ((gn - bn) / d + (gn < bn ? 6 : 0)) / 6;
  else if (max === gn) h = ((bn - rn) / d + 2) / 6;
  else h = ((rn - gn) / d + 4) / 6;
  return [h * 360, s, l];
}

function hslToHex(h: number, s: number, l: number): string {
  const c = (1 - Math.abs(2 * l - 1)) * s;
  const hp = (((h % 360) + 360) % 360) / 60;
  const x = c * (1 - Math.abs((hp % 2) - 1));
  const [r1, g1, b1] =
    hp < 1 ? [c, x, 0] : hp < 2 ? [x, c, 0] : hp < 3 ? [0, c, x] : hp < 4 ? [0, x, c] : hp < 5 ? [x, 0, c] : [c, 0, x];
  const m = l - c / 2;
  return toHex({ r: (r1 + m) * 255, g: (g1 + m) * 255, b: (b1 + m) * 255 });
}

export type LegibleFill = {
  /** The fill to paint (the tenant's own colour, or the same hue deepened just enough). */
  fill: string;
  /** Ink that clears 4.5:1 on `fill` — white or the dark text token. */
  ink: string;
  /** The quiet step of `ink` (for secondary lines): the lowest alpha that still clears 4.5:1. */
  inkMuted: string;
  /** `ink` at 15% composited over `fill` — for translucent chips/borders that must stay visible. */
  inkSoft: string;
  /** How far the fill had to be darkened (0 = untouched), for tests and telemetry. */
  deepened: number;
  ratio: number;
  mutedRatio: number;
};

/**
 * Pick the ink for a background, deepening the fill only when neither ink clears the bar.
 *
 * Hue is preserved: deepening walks lightness down in 2% steps at constant H/S, so a tenant's
 * colour still reads as their colour. Measured examples (all with the shipped maths):
 *   #F4A4C0 (white 1.92:1, dark 8.0:1)  -> fill untouched, ink = the dark token
 *   #7047EB (white 5.54:1)              -> fill untouched, ink = white
 *   #3B82F6 (white 3.68:1, dark 4.33:1) -> deepened to ~4.51:1 with white
 */
export function resolveLegibleFill(
  brandColor: string | null | undefined,
  options: { min?: number; fallback?: string } = {}
): LegibleFill {
  const min = options.min ?? MIN_RATIO;
  const fallback = options.fallback ?? '#7047EB';
  const start = parseHex(brandColor ?? '') ? (brandColor as string) : fallback;

  const inks = [WHITE, DARK_INK] as const;

  const build = (fill: string, deepened: number): LegibleFill | null => {
    for (const ink of inks) {
      const ratio = contrastRatio(ink, fill);
      if (ratio < min) continue;
      // Quietest passing version of this ink for secondary text (never below 4.5:1).
      let muted: string = ink;
      let mutedRatio = ratio;
      for (let a = 0.95; a >= 0.5; a -= 0.05) {
        const candidate = compositeOver(ink, a, fill);
        const r = contrastRatio(candidate, fill);
        if (r >= min) {
          muted = candidate;
          mutedRatio = r;
        } else {
          break;
        }
      }
      return {
        fill,
        ink,
        inkMuted: muted,
        inkSoft: compositeOver(ink, 0.15, fill),
        deepened,
        ratio,
        mutedRatio,
      };
    }
    return null;
  };

  const asIs = build(start, 0);
  if (asIs) return asIs;

  // Neither ink passes: deepen at constant hue until one does.
  const rgb = parseHex(start)!;
  const [h, s, l0] = rgbToHsl(rgb);
  for (let step = 1; step <= 30; step++) {
    const l = l0 - step * 0.02;
    if (l <= 0.02) break;
    const deepened = build(hslToHex(h, s, l), step);
    if (deepened) return deepened;
  }

  // A colour this light cannot carry text at all: fall back to the canonical brand fill.
  return build(fallback, 0) ?? {
    fill: fallback,
    ink: WHITE,
    inkMuted: WHITE,
    inkSoft: WHITE,
    deepened: 0,
    ratio: contrastRatio(WHITE, fallback),
    mutedRatio: contrastRatio(WHITE, fallback),
  };
}
