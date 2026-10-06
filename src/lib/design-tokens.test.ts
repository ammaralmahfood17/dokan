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
  // Strip CSS comments FIRST. The Wave 3 fixes put an explanatory comment inside the blocks
  // they change, and a comment sits between the previous `;` and the property - so the naive
  // (?:^|;) anchor missed the very declaration it was meant to read. Stripping keeps this
  // guardrail honest against real CSS, comments included.
  const clean = block.replace(/\/\*[\s\S]*?\*\//g, '');
  const m = clean.match(new RegExp(`(?:^|;)\\s*${property}:\\s*([^;]+)`));
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

/**
 * Wave 3 T1 (audit T1 #1, CRITICAL) - WCAG 2.2 SC 2.4.11 / 1.4.11: a focus indicator must be
 * at least 3:1 against what it sits on. The old ring was rgba(79,70,229,.25), which composites
 * to #D3D1F8 on white - a measured 1.47:1, so keyboard focus was effectively invisible.
 */
describe('focus indicator is perceivable (WCAG 2.2 SC 2.4.11 / 1.4.11: 3:1)', () => {
  it(':focus-visible uses a solid outline in --color-primary', () => {
    const block = rule('*:focus-visible');
    const outline = declaration(block, 'outline');
    expect(outline, 'outline must not be none').not.toMatch(/none/);
    expect(outline).toMatch(/var\(--color-primary\)/);
    expect(ratio(token('color-primary'), token('color-surface'))).toBeGreaterThanOrEqual(3);
    expect(ratio(token('color-primary'), token('color-bg'))).toBeGreaterThanOrEqual(3);
  });
});

/**
 * Wave 3 T2 (audit T1 #2, CRITICAL) - WCAG 1.4.11: the boundary that makes a control
 * perceivable needs 3:1. --color-border is rgba(20,20,15,.08) = a 1.18:1 hairline, which is
 * correct for a divider and a failure as a control boundary.
 */
describe('form control boundaries meet WCAG 1.4.11 (3:1)', () => {
  it('--color-border-control clears 3:1 against every surface it is drawn on', () => {
    const c = token('color-border-control');
    for (const bg of ['color-surface', 'color-bg', 'color-surface-sunken']) {
      expect(ratio(c, token(bg)), `${c} on ${token(bg)}`).toBeGreaterThanOrEqual(3);
    }
  });

  it('.input renders that token, not the decorative hairline', () => {
    const block = rule('.input, .select, .textarea');
    expect(declaration(block, 'border')).toMatch(/var\(--color-border-control\)/);
  });

  it('.card and table dividers keep the decorative hairline', () => {
    // The fix must not turn every divider into a heavy line.
    const card = rule('.card');
    expect(declaration(card, 'border')).toMatch(/var\(--color-border\)/);
  });
});

/**
 * Wave 3 T4 (audit T1 #4) - WCAG 1.4.3 at the COMPONENT level.
 *
 * This finding survived the original audit because the guard watched globals.css while the
 * real product renders a Tailwind class string from a component. So the component is parsed
 * too: its tone pairs are resolved from the tokens and measured, and the specific class that
 * caused the 4.34:1 is named so it cannot come back.
 */
const statusChip = readFileSync(resolve(process.cwd(), 'src/components/ui/status-chip.tsx'), 'utf8');

describe('StatusChip tones meet 4.5:1 (WCAG 1.4.3)', () => {
  const tones: [string, string, string][] = [
    ['color-warn', 'color-warn-tint', 'pending'],
    ['color-info', 'color-info-tint', 'preparing'],
    ['color-success', 'color-success-tint', 'ready'],
    ['color-text-secondary', 'color-surface-sunken', 'delivered'],
    ['color-danger', 'color-danger-tint', 'cancelled'],
  ];
  it.each(tones)('%s on %s - %s', (fg, bg, label) => {
    expect(ratio(token(fg), token(bg)), label).toBeGreaterThanOrEqual(4.5);
  });

  it('the delivered tone does not use text-muted on the sunken surface', () => {
    const delivered = statusChip.match(/delivered:\s*'([^']+)'/)?.[1] ?? '';
    expect(delivered).not.toMatch(/color-text-muted/);
    expect(delivered).toMatch(/color-text-secondary/);
  });
});

describe('the focus ring cannot be defeated by a control rule (audit T1 #1)', () => {
  it('the control block does not declare outline: none', () => {
    // This is not hypothetical: `outline: none` inside the UNLAYERED .input rule outranked the
    // focus rule in @layer base (layers lose to unlayered rules at equal specificity), so the
    // ring was invisible on every input while the skip link showed it. Measured in Chrome.
    // Comments stripped: this very rule carries a comment explaining the removed declaration,
    // and a naive match read the comment as the declaration (the same trap as the T1 #2 parser).
    const block = rule('.input, .select, .textarea').replace(/\/\*[\s\S]*?\*\//g, '');
    expect(block).not.toMatch(/outline\s*:\s*none/);
  });

  it('the ring declaration is top-level, not nested inside @layer', () => {
    // It sat inside `@layer base { ... }` (indented) and lost the cascade to the unlayered
    // `.input { outline: none }` at equal specificity. Unlayered + later in the file is what
    // makes the ring win, so the rule that DECLARES it must start at column 0.
    const topLevel = css.match(/^\*:focus-visible\s*\{([\s\S]*?)\n\}/m);
    expect(topLevel, 'a top-level *:focus-visible rule must exist').toBeTruthy();
    expect(topLevel![1]).toMatch(/outline:\s*2px solid var\(--color-primary\)/);

    // A nested copy may only adjust transitions (the reduced-motion block does exactly that);
    // it must never re-declare the ring, where an unlayered rule could outrank it again.
    for (const nested of css.matchAll(/^[ \t]+\*:focus-visible\s*\{([\s\S]*?)\n\}/gm)) {
      expect(nested[1], 'a nested rule must not (re)declare the ring').not.toMatch(/\boutline\s*:/);
    }
  });

});
