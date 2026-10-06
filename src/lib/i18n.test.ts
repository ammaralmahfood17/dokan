import { readFileSync, globSync } from 'node:fs';
import { describe, expect, it } from 'vitest';
import { langOfText } from './i18n';

/**
 * Audit T1 #8 (WCAG 3.1.2) — the public menu holds English content (product `name_en` behind the
 * language toggle) inside an Arabic page, and nothing marked it.
 *
 * The marker is decided by the TEXT, not by the toggle: a store named in Arabic is Arabic with the
 * toggle on EN, and a Latin-script name is English with it on AR. Marking by the toggle would
 * attach the wrong language to half the cases - which is a worse lie to a screen reader than no
 * marker at all.
 *
 * The Arabic literals are written as escapes so the file survives any toolchain that mangles
 * raw non-ASCII on the way in.
 */
const AR_STORE = '\u0627\u0633\u062a\u0643\u0627\u0646\u0629'; // استكانة
const AR_DRINK = '\u0644\u0627\u062a\u064a\u0647 \u0645\u062b\u0644\u062c'; // لاتيه مثلج
const AR_COFFEE_24 = '\u0642\u0647\u0648\u0629 24'; // قهوة 24

describe('langOfText', () => {
  it('marks Latin-script text as English', () => {
    expect(langOfText('Estikana')).toBe('en');
    expect(langOfText('Iced Latte')).toBe('en');
    expect(langOfText('Cafe 24/7')).toBe('en');
  });

  it('leaves Arabic text to inherit the document language', () => {
    expect(langOfText(AR_STORE)).toBeUndefined();
    expect(langOfText(AR_DRINK)).toBeUndefined();
    expect(langOfText(AR_COFFEE_24)).toBeUndefined(); // Arabic letters + Latin digits is Arabic
  });

  it('treats mixed Arabic + Latin as Arabic (never overwrite the document language)', () => {
    expect(langOfText(`Estikana ${AR_STORE}`)).toBeUndefined();
  });

  it('documents the neutral cases instead of leaving them to chance', () => {
    // A pure-digit string carries no language signal; marking it 'en' is harmless and is at least
    // a decision. Asserted so a future change to the rule has to be deliberate.
    expect(langOfText('24')).toBe('en');
    expect(langOfText('')).toBe('en');
  });
});

describe('numerals are Latin everywhere (audit T1 #10, T1 #11)', () => {
  it('no Arabic-Indic digits in user-facing source', () => {
    // Arabic-Indic digits (٠١٢…) render inconsistently across the Gulf market's devices and fonts,
    // and the product's own convention is Latin digits everywhere - a rule that had already drifted
    // in five strings. `src/lib/utils.ts` is excluded on purpose: it holds the transliteration MAP
    // (data, not copy) and a comment explaining the rule, which is not user-facing text.
    const files = globSync('src/**/*.{ts,tsx}').filter(
      (f) =>
        !f.endsWith('.test.ts') &&
        !f.endsWith('.test.tsx') &&
        !f.endsWith('lib/utils.ts')
    );
    const offenders = files
      .filter((f) => /[\u0660-\u0669]/.test(readFileSync(f, 'utf8')))
      .map((f) => {
        const hit = readFileSync(f, 'utf8').split('\n').findIndex((l) => /[\u0660-\u0669]/.test(l));
        return `${f}:${hit + 1}`;
      });
    expect(offenders, 'use Latin digits in the UI (١٢٣ -> 123)').toEqual([]);
  });
});
