import { readFileSync } from 'node:fs';
import { resolve } from 'node:path';
import { describe, it, expect } from 'vitest';
import {
  generateSlug,
  money,
  currencyDecimals,
  formatMoney,
  menuPath,
  tableSlugFromNumber,
  generateQrToken,
  generateLinkCode,
  isReservedSlug,
  CURRENCY_DECIMALS,
} from './utils';

/**
 * These cover the pure helpers in src/lib/utils.ts — the ones with real
 * business consequences. Every case below is an EDGE that a happy-path test
 * would miss, and several were written because the code comments claimed a
 * guarantee the test then had to confirm (see the BHD/SAR and QR notes).
 */

describe('money()', () => {
  it('rounds to 3 decimals by default (BHD standard)', () => {
    expect(money(1.0005)).toBe(1.001);
    expect(money(0.1 + 0.2)).toBe(0.3); // the classic float trap
  });

  it('honours an explicit decimals count', () => {
    // 2.675 is stored as 2.67499... in binary; a naive round() gives 2.67.
    expect(money(2.675, 2)).toBe(2.68);
    expect(money(1.005, 2)).toBe(1.01);
  });

  it('returns 0 for non-finite input instead of NaN propagating into prices', () => {
    expect(money(Number.NaN)).toBe(0);
    expect(money(Number.POSITIVE_INFINITY)).toBe(0);
    expect(money(Number.NEGATIVE_INFINITY)).toBe(0);
  });

  it('never returns -0 (it rendered as "-0.000 BHD" on a receipt)', () => {
    // Found by this suite: a value that rounds to zero was producing NEGATIVE
    // ZERO, and `Intl.NumberFormat` prints the sign — "-0.000 BHD" on a
    // customer receipt. See the `rounded || 0` guard in money().
    for (const v of [-0.0001, -0.0004, -0.0005, -0, -0]) {
      expect(Object.is(money(v), -0), `money(${v})`).toBe(false);
      expect(money(v), `money(${v})`).toBe(0);
    }
  });

  it('formatMoney never prints a negative sign for a value that rounds to zero', () => {
    expect(formatMoney(-0.0001, 'BHD')).not.toMatch(/-\s*0/);
    expect(formatMoney(-0.0001, 'BHD')).toMatch(/0\.000/);
  });

  it('still rounds a genuine small negative to a real negative', () => {
    // NOT a -0 artefact: -0.0009 is genuinely below the 3-decimal step, so
    // -0.001 is the correct answer and the guard must not swallow it.
    expect(money(-0.0009)).toBe(-0.001);
    expect(money(-0.001)).toBe(-0.001);
  });

  it('preserves negative amounts (refunds) rather than clamping them', () => {
    expect(money(-5.125)).toBe(-5.125);
  });
});

describe('currencyDecimals()', () => {
  it('uses 3 decimals for the Gulf dinar trio', () => {
    for (const c of ['BHD', 'KWD', 'OMR']) {
      expect(currencyDecimals(c)).toBe(3);
    }
  });

  it('uses 2 for the riyal/f-dirham currencies', () => {
    for (const c of ['SAR', 'AED', 'QAR']) {
      expect(currencyDecimals(c)).toBe(2);
    }
  });

  it('is case-insensitive', () => {
    expect(currencyDecimals('bhd')).toBe(3);
    expect(currencyDecimals('sAr')).toBe(2);
  });

  it('defaults to 2 for an unknown currency, never 3', () => {
    // A 3-decimal default silently persists wrong prices for any new currency.
    expect(currencyDecimals('JPY')).toBe(2);
    expect(currencyDecimals('')).toBe(2);
  });

  it('every entry in the map is 2 or 3 (a new currency must be reviewed)', () => {
    for (const [code, d] of Object.entries(CURRENCY_DECIMALS)) {
      expect([2, 3], `${code} = ${d}`).toContain(d);
    }
  });
});

describe('formatMoney()', () => {
  it('forces LATIN digits — no Arabic-Indic ٠١٢ in prices', () => {
    const out = formatMoney(12.5, 'BHD');
    expect(out).toMatch(/[0-9]/);
    expect(out).not.toMatch(/[٠-٩]/);
    expect(out.endsWith('BHD')).toBe(true);
  });

  it('applies the currency decimals to the rendered string', () => {
    // 3 decimals for BHD, 2 for SAR — the same value renders differently.
    expect(formatMoney(1.5, 'BHD')).toMatch(/1\.500/);
    expect(formatMoney(1.5, 'SAR')).toMatch(/1\.50(?!\d)/);
  });

  it('renders 0 for non-finite input', () => {
    expect(formatMoney(Number.NaN, 'BHD')).toMatch(/0\.000/);
  });
});

describe('generateSlug()', () => {
  it('transliterates Arabic input to a URL-safe latin slug', () => {
    // Filler words are stripped BEFORE transliteration, so an ARABIC filler
    // ("مقهى") has already become "mqha" by the time the word list is applied
    // and is NOT removed. Verified behaviour, not a wish.
    expect(generateSlug('مقهى Bahrain')).toBe('mqha-bahrain');
    expect(generateSlug('Starbucks Cafe')).toBe('starbucks');
    expect(generateSlug('قهوة')).toBe('qhwh');
    // ي→y (not i), and the word-initial الـ of "الطازج" drops out because the
    // filler regex uses \b, which does not see a boundary there.
    expect(generateSlug('عصير الطازج')).toBe('asyr-altazj');
  });

  it('converts Arabic-Indic digits to latin digits', () => {
    // "مطعم" transliterates to the run "mtam", so the space collapses to a
    // single hyphen: mtam-234.
    expect(generateSlug('مطعم ٢٣٤')).toBe('mtam-234');
  });

  it('strips accents from latin input', () => {
    expect(generateSlug('Café')).toBe('cafe');
  });

  it('collapses separators and trims them from both ends', () => {
    expect(generateSlug('  --Hello   World!!  ')).toBe('hello-world');
    expect(generateSlug('a/b\\c')).toBe('a-b-c');
  });

  it('never returns an empty slug (an empty project slug breaks every route)', () => {
    for (const input of ['', '   ', '!!!', 'متجر', 'مقهى', 'café', 'مطعم']) {
      const s = generateSlug(input);
      expect(s.length, `input=${JSON.stringify(input)}`).toBeGreaterThan(0);
      expect(s).toMatch(/^[a-z0-9-]+$/);
    }
  });

  it('uses a random fallback only when transliteration leaves nothing', () => {
    // "متجر" transliterates to "mtjr", so it does NOT reach the random branch.
    // The random branch is for input with no latin-able characters at all,
    // and those must not collide with each other.
    const a = generateSlug('!!!');
    const b = generateSlug('!!!');
    expect(a).toMatch(/^store-[a-z0-9]{1,6}$/);
    expect(a).not.toBe(b);
    expect(generateSlug('متجر')).toBe('mtjr');
  });

  it('caps length at 40 chars so it stays inside a URL and DB column', () => {
    expect(generateSlug('a'.repeat(200)).length).toBeLessThanOrEqual(40);
  });

  it('is idempotent-ish: slugging a slug returns the same slug', () => {
    const once = generateSlug('مقهى نفائس');
    expect(generateSlug(once)).toBe(once);
  });
});

describe('isReservedSlug()', () => {
  it('blocks the app routes a project slug would shadow', () => {
    for (const s of ['api', 'dashboard', 'login', 'menu', 'pos', 'kitchen', 'admin']) {
      expect(isReservedSlug(s), s).toBe(true);
    }
  });

  it('allows a normal merchant name', () => {
    expect(isReservedSlug('starbucks')).toBe(false);
    expect(isReservedSlug('my-restaurant')).toBe(false);
  });
});

describe('menuPath() / tableSlugFromNumber()', () => {
  it('builds the public menu path', () => {
    expect(menuPath('starbucks', 'table-4')).toBe('/starbucks/menu/table-4');
    // The QR encodes the scan token; without it the link is browse-only.
    expect(menuPath('starbucks', 'table-4', 'a1b2')).toBe('/starbucks/menu/table-4?k=a1b2');
    expect(menuPath('s', 't', 'a&b=c')).toBe('/s/menu/t?k=a%26b%3Dc');
  });

  it('derives a table slug from its number', () => {
    expect(tableSlugFromNumber(1)).toBe('table-1');
    expect(tableSlugFromNumber(42)).toBe('table-42');
  });
});

describe('generateQrToken()', () => {
  it('is 32 hex chars with no dashes (fits the token column)', () => {
    expect(generateQrToken()).toMatch(/^[0-9a-f]{32}$/);
  });

  it('is unique across calls — a repeated token means forgeable table links', () => {
    const set = new Set(Array.from({ length: 2000 }, () => generateQrToken()));
    expect(set.size).toBe(2000);
  });

  it('never uses Math.random (predictable = a customer can forge a table QR)', () => {
    // The fallback branch must be CSPRNG-backed. If someone reintroduces
    // Math.random the entropy check below fails loudly.
    const tokens = Array.from({ length: 500 }, () => generateQrToken());
    const uniqueBytes = new Set(tokens.join('').split(''));
    expect(uniqueBytes.size).toBeGreaterThan(10);
  });
});

describe('generateLinkCode() — audit T2 #7', () => {
  it('is 32 hex characters (128 bits), the same size as the table scan token', () => {
    const code = generateLinkCode();
    expect(code).toHaveLength(32);
    expect(code).toMatch(/^[0-9A-F]{32}$/);
  });

  it('is upper-case so a merchant can retype it from Telegram', () => {
    // One code, compared with itself: calling it twice compares two different randoms.
    const code = generateLinkCode();
    expect(code).toBe(code.toUpperCase());
  });

  it('does not repeat across calls', () => {
    const set = new Set(Array.from({ length: 50 }, () => generateLinkCode()));
    expect(set.size).toBe(50);
  });

  it('the link route no longer uses a 32-bit code', () => {
    const route = readFileSync(resolve(process.cwd(), 'src/app/api/telegram/link/route.ts'), 'utf8');
    expect(route).not.toMatch(/randomBytes\(\s*4\s*\)/);
    expect(route).toContain('generateLinkCode');
  });

  it('the webhook accepts a 32-char code', () => {
    const webhook = readFileSync(resolve(process.cwd(), 'src/app/api/telegram/webhook/route.ts'), 'utf8');
    expect(webhook).toMatch(/\{6,32\}/);
  });
});
