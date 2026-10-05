import { readFileSync } from 'node:fs';
import { resolve } from 'node:path';
import { describe, expect, it } from 'vitest';

/**
 * Contrast guard for the design tokens.
 *
 * The Aug-2026 audit found muted/secondary text under 3:1; those values were fixed
 * by hand and nothing stopped the next one from regressing. This test closes that.
 *
 * Two halves, deliberately:
 *
 *  1. Explicit TOKEN PAIRS for text that is written inline in JSX
 *     (`text-[var(--color-text-muted)]`), which no static parse can enumerate.
 *  2. Parsed BADGE RULES — the test reads `.badge-*` out of globals.css, resolves the
 *     `var(-- …)` in its own `color`/`background`, and checks THOSE. A hand-maintained
 *     list would have been written with the already-fixed pair and passed while the
 *     real declaration was still broken; reading the declaration is what makes the
 *     red/green cycle honest, and it keeps guarding the badge after future edits.
 *
 * Every pair here is NORMAL-size UI text (badges and hints are 12px), so the WCAG 2.1
 * AA bar is 4.5:1 — not the 3:1 allowance that large or bold-large text would earn.
 */
const css = readFileSync(resolve(process.cwd(), 'src/app/globals.css'), 'utf8');

function token(name: string): string {
  const m = css.match(new RegExp(`--${name}:\\s*(#[0-9A-Fa-f]{6})`));
  if (!m) throw new Error(`token --${name} not found in src/app/globals.css`);
  return m[1];
}

/** The declaration block of a simple class selector, e.g. `.badge-delivered { … }`. */
function rule(selector: string): string {
  const escaped = selector.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
  const m = css.match(new RegExp(`${escaped}\\s*\\{([^}]*)\\}`));
  if (!m) throw new Error(`rule ${selector} not found in src/app/globals.css`);
  return m[1];
}

function declaration(block: string, property: string): string {
  const m = block.match(new RegExp(`(?:^|;)\\s*${property}:\\s*([^;]+)`));
  if (!m) throw new Error(`no "${property}" declaration in block: ${block.trim().slice(0, 80)}`);
  return m[1].trim();
}

/** `var(--color-x)` → its hex; a literal colour passes through. */
function resolveColor(value: string): string {
  const v = value.match(/var\(\s*--([a-z0-9-]+)\s*\)/i);
  return v ? token(v[1]) : value;
}

function channel(c: number): number {
  const v = c / 255;
  return v <= 0.03928 ? v / 12.92 : ((v + 0.055) / 1.055) ** 2.4;
}

function luminance(hex: string): number {
  const h = hex.replace('#', '');
  const [r, g, b] = [0, 2, 4].map((i) => parseInt(h.slice(i, i + 2), 16));
  return 0.2126 * channel(r) + 0.7152 * channel(g) + 0.0722 * channel(b);
}

function ratio(fg: string, bg: string): number {
  const a = luminance(fg);
  const b = luminance(bg);
  const [hi, lo] = a > b ? [a, b] : [b, a];
  return (hi + 0.05) / (lo + 0.05);
}

/** [foreground, background, what it renders] — text written inline in JSX. */
const PAIRS: [string, string, string][] = [
  ['color-text', 'color-bg', 'body text on the page background'],
  ['color-text', 'color-surface', 'body text on a card'],
  ['color-text-secondary', 'color-bg', 'secondary text on the page background'],
  ['color-text-secondary', 'color-surface', 'secondary text on a card'],
  ['color-text-secondary', 'color-surface-sunken', 'table header on the sunken surface'],
  ['color-text-muted', 'color-bg', 'hint text on the page background'],
  ['color-text-muted', 'color-surface', 'hint text on a card'],
  ['color-primary', 'color-surface', 'primary action text on a card'],
];

describe('design tokens meet WCAG AA (4.5:1) for normal-size text', () => {
  it.each(PAIRS)('%s on %s — %s', (fg, bg, label) => {
    expect(ratio(token(fg), token(bg)), `${label} (${token(fg)} on ${token(bg)})`).toBeGreaterThanOrEqual(4.5);
  });

  it.each([
    '.badge-pending',
    '.badge-preparing',
    '.badge-ready',
    '.badge-delivered',
    '.badge-cancelled',
  ])('%s clears 4.5:1 against its own tint', (selector) => {
    const block = rule(selector);
    const fg = resolveColor(declaration(block, 'color'));
    const bg = resolveColor(declaration(block, 'background'));
    expect(ratio(fg, bg), `${selector} (${fg} on ${bg})`).toBeGreaterThanOrEqual(4.5);
  });
});
