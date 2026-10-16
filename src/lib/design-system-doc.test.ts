import { describe, expect, it } from 'vitest';
import { readFileSync } from 'node:fs';
import { resolve } from 'node:path';

/**
 * The design doc must describe the SHIPPED palette.
 *
 * WHY (frontend audit F-9, 2026-10-16): DESIGN_SYSTEM.md documented a palette the code does not
 * use — Primary `#4F46E5` vs the shipped `#7047EB`, Background `#F8FAFC` vs `#FAF9F6`, Text
 * `#0F172A` vs `#1F2320` — SEVEN tokens wrong, including the whole Hover/Active/Tint ladder and
 * the "Indigo لا يظهر إلا في…" rule. A new contributor reading the doc builds in a palette the
 * product retired, and the drift is invisible: nothing else in the repo compares the two files.
 *
 * This test does exactly that comparison, for every row in the doc that names a `--color-*` token.
 * It parses both files rather than hard-coding pairs, so ADDING a token to the doc without adding
 * it to the stylesheet (or vice versa) is caught too.
 */

const doc = readFileSync(resolve(process.cwd(), 'DESIGN_SYSTEM.md'), 'utf8');
const css = readFileSync(resolve(process.cwd(), 'src/app/globals.css'), 'utf8');

/** --color-* -> the value shipped in :root. */
function shippedTokens(source: string): Map<string, string> {
  const out = new Map<string, string>();
  for (const m of source.matchAll(/--(color-[a-z0-9-]+):\s*([^;]+);/g)) {
    out.set(`--${m[1]}`, m[2].trim());
  }
  return out;
}

/** Every `| label | `value` | `--color-token` | … |` row in the doc. */
function documentedRows(source: string): { token: string; value: string }[] {
  const out: { token: string; value: string }[] = [];
  for (const m of source.matchAll(/\|\s*[^|]+?\s*\|\s*`([^`]+)`\s*\|\s*`(--color-[a-z0-9-]+)`\s*\|/g)) {
    out.push({ value: m[1].trim(), token: m[2] });
  }
  return out;
}

const shipped = shippedTokens(css);
const rows = documentedRows(doc);

const normalize = (v: string) => v.replace(/\s+/g, '').toUpperCase();

describe('DESIGN_SYSTEM.md — the documented palette is the shipped palette', () => {
  it('finds a meaningful number of rows (the parser has not silently stopped matching)', () => {
    expect(rows.length).toBeGreaterThanOrEqual(15);
    expect(shipped.size).toBeGreaterThanOrEqual(15);
  });

  it('never names a token the stylesheet does not define', () => {
    const missing = rows.filter((r) => !shipped.has(r.token)).map((r) => r.token);
    expect(missing, `documented but not shipped: ${missing.join(', ')}`).toEqual([]);
  });

  it.each(rows.map((r) => [r.token, r] as const))('%s documents the shipped value', (_token, row) => {
    expect(normalize(row.value)).toBe(normalize(shipped.get(row.token)!));
  });

  it('names the shipped typeface, not the retired one', () => {
    // The doc claimed "Cairo فقط" in four places while the product has shipped thmanyah sans
    // since the owner's one-family decision (2026-10-07). A doc that names a font we do not
    // ship is the same defect class as a doc that names a palette we do not ship.
    expect(doc.toLowerCase()).not.toContain('cairo');
    expect(doc.toLowerCase()).toContain('thmanyah sans');
  });

  it('does not keep the retired palette in prose', () => {
    // The doc used to be written around indigo + cool slate; a stray sentence re-introducing it
    // is how the drift started.
    for (const retired of ['#4F46E5', '#4338CA', '#3730A3', '#EEF2FF', '#E0E7FF', '#F8FAFC', '#0F172A', '#475569']) {
      expect(doc.toUpperCase()).not.toContain(retired);
    }
  });
});
