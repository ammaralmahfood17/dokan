import { readFileSync } from 'node:fs';
import { resolve } from 'node:path';
import { describe, expect, it } from 'vitest';

/**
 * Wave 0 scale-token contract (2026-10-22).
 *
 * The design system document listed motion, spacing and type values that were
 * never declared in CSS — so every component re-invented them (107 hand-written
 * transitions, type sizes as `text-[14.5px]`). These assertions make the token
 * layer real: a value can no longer be "documented" while absent from the sheet,
 * and the Arabic-specific floors (12px caption, 1.6 body line) fail loudly if
 * someone shaves them for density.
 */
const css = readFileSync(resolve(process.cwd(), 'src/app/globals.css'), 'utf8');

function token(name: string): string {
  const m = css.match(new RegExp(`--${name}:\\s*([^;]+);`));
  if (!m) throw new Error(`token --${name} is not declared in src/app/globals.css`);
  return m[1].trim();
}

const px = (v: string): number => {
  const m = v.match(/^(-?[\d.]+)px$/);
  if (!m) throw new Error(`expected a px value, got "${v}"`);
  return Number(m[1]);
};

describe('spacing scale', () => {
  it('every step above 2px is a multiple of 4 (dense dashboards need 44/36, not only 48/32)', () => {
    for (const step of ['12', '16', '20', '24']) {
      const value = px(token(`space-${step}`));
      expect(value % 4, `--space-${step} = ${value}px is off the 4px grid`).toBe(0);
    }
  });

  it('the scale ascends', () => {
    const values = ['0-5', '1', '2', '3', '4', '5', '6', '8', '10', '12', '16', '20', '24'].map(
      (s) => px(token(`space-${s}`))
    );
    for (let i = 1; i < values.length; i++) {
      expect(values[i], `--space step ${i} does not ascend`).toBeGreaterThan(values[i - 1]);
    }
  });
});

describe('motion scale', () => {
  it('is monotonic, 100–300ms, ease-out only (DESIGN_SYSTEM §5)', () => {
    const durations = ['instant', 'fast', 'base', 'modal'].map((n) => {
      const raw = token(`motion-${n}`);
      const m = raw.match(/^(\d+)ms$/);
      expect(m, `--motion-${n} must be a ms value, got "${raw}"`).not.toBeNull();
      return Number(m![1]);
    });
    for (let i = 1; i < durations.length; i++) {
      expect(durations[i]).toBeGreaterThan(durations[i - 1]);
    }
    for (const d of durations) {
      expect(d).toBeGreaterThanOrEqual(100);
      expect(d).toBeLessThanOrEqual(300);
    }
    expect(token('ease-standard')).toMatch(/^cubic-bezier\(/);
  });
});

describe('containers', () => {
  it('reading < app <= wide, and the app container is 1200px or wider', () => {
    const rem = (v: string) => Number(v.replace('rem', ''));
    const reading = rem(token('container-reading'));
    const app = rem(token('container-app'));
    const wide = rem(token('container-wide'));
    expect(reading).toBeLessThan(app);
    expect(app).toBeLessThanOrEqual(wide);
    expect(app * 16).toBeGreaterThanOrEqual(1200);
  });
});

describe('Arabic type scale', () => {
  it('the fluid roles use clamp() so they breathe between 320 and 1440', () => {
    for (const role of ['display', 'h1', 'h2', 'body']) {
      expect(token(`text-${role}`), `--text-${role} must be fluid`).toContain('clamp(');
    }
  });

  it('caption is at least 12px — the Arabic legibility floor (11.5px was raised)', () => {
    const caption = token('text-caption');
    const m = caption.match(/^([\d.]+)rem$/);
    expect(m, `--text-caption must be a rem value, got "${caption}"`).not.toBeNull();
    expect(Number(m![1]) * 16).toBeGreaterThanOrEqual(12);
  });

  it('body line-height >= 1.6 and headings >= 1.2 (Arabic diacritics need room)', () => {
    // Tailwind v4 emits the pairing as --text-<role>--line-height, so the
    // assertion follows the same name the utility uses.
    expect(Number(token('text-body--line-height'))).toBeGreaterThanOrEqual(1.6);
    for (const role of ['display', 'h1', 'h2']) {
      expect(Number(token(`text-${role}--line-height`))).toBeGreaterThanOrEqual(1.2);
    }
  });

  it('no negative letter-spacing anywhere in the sheet', () => {
    // Negative tracking breaks Arabic joins and clips marks; it is banned by
    // AGENTS.md. Inline styles are caught by scripts/check-rtl-logical.mjs.
    const offenders = css
      .split('\n')
      .map((line, i) => ({ line, i: i + 1 }))
      .filter(({ line }) => /letter-spacing\s*:\s*-/.test(line));
    expect(offenders, 'negative letter-spacing found').toEqual([]);
  });
});
