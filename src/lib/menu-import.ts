/**
 * Menu import parser — turns a pasted menu (names + prices, optional category
 * headers) into product rows. Pure, no IO: the caller previews, then writes.
 *
 * Accepted line shapes (the LAST numeric token is the price):
 *   شاورما دجاج 1.500
 *   شاورما دجاج - 1.500
 *   شاورما دجاج | 1.500 | ساندويتشات
 *   شاورما دجاج — 1.5 د.ب
 * Category headers (the line has no price) in any of these shapes:
 *   ساندويتشات:   /   [ساندويتشات]   /   == ساندويتشات ==
 * Arabic-Indic digits and a trailing currency marker are accepted.
 */

export type ParsedMenuItem = {
  name: string;
  price: number;
  category: string | null;
  line: number;
};

export type ParseError = {
  line: number;
  raw: string;
  reason: 'no-price' | 'bad-price' | 'empty-name';
};

export type ParseResult = {
  items: ParsedMenuItem[];
  errors: ParseError[];
};

/** Arabic-Indic and extended Arabic-Indic digits → ASCII. */
export function normalizeDigits(input: string): string {
  return input.replace(/[\u0660-\u0669\u06F0-\u06F9]/g, (d) => {
    const code = d.charCodeAt(0);
    const base = code >= 0x06f0 ? 0x06f0 : 0x0660;
    return String(code - base);
  });
}

/** Price token at the end of the line, allowing a currency marker after it. */
const PRICE_AT_END =
  /(?:^|[\s|،,\-–—:]+)(\d+(?:[.,]\d{1,4})?)\s*(?:د\.?ب|دينار|BD|BHD|ر\.?س)?\s*$/i;

const HEADER = /^\s*(?:==+|-{2,}|\[|【)?\s*([^|[\]【】=:\-–—].{0,60}?)\s*(?:\]|】|==+|-{2,}|:)\s*$/;

const CURRENCY_ANYWHERE = /\s*(?:د\.?ب|دينار|BD|BHD|ر\.?س)\s*$/i;

function cleanName(raw: string): string {
  return raw
    .replace(/[\s|،,\-–—:]+$/g, '')
    .replace(/^\s*[\-–—•*]+\s*/g, '')
    .replace(/\s+/g, ' ')
    .trim();
}

/**
 * Parse one pasted menu. Never throws: unparseable lines come back in `errors`
 * so the caller can show them and let the owner fix just those lines.
 */
export function parseMenuText(input: string): ParseResult {
  const items: ParsedMenuItem[] = [];
  const errors: ParseError[] = [];
  let category: string | null = null;
  let lastWasItem = false;

  const lines = input.split(/\r?\n/);

  lines.forEach((rawLine, index) => {
    const lineNo = index + 1;
    const raw = rawLine.trim();
    if (!raw) return;

    const text = normalizeDigits(raw)
      .replace(CURRENCY_ANYWHERE, '')
      .replace(/[\s|،,\-–—:]+$/, '')
      .trim();

    // Explicit 3-column shape: name | price | category
    if (text.includes('|')) {
      const cols = text.split('|').map((c) => c.trim());
      if (cols.length >= 2 && cols[0] && cols[1]) {
        const price = toPrice(cols[1]);
        if (price === null) {
          errors.push({ line: lineNo, raw, reason: 'bad-price' });
          return;
        }
        const name = cleanName(cols[0]);
        if (!name) {
          errors.push({ line: lineNo, raw, reason: 'empty-name' });
          return;
        }
        const colCategory = cols[2] ? cleanName(cols[2]) : null;
        if (colCategory) category = colCategory;
        items.push({ name, price, category: colCategory ?? category, line: lineNo });
        lastWasItem = true;
        return;
      }
    }

    const match = text.match(PRICE_AT_END);
    if (!match) {
      // No price: a header only when it is marked as one, or when it directly
      // precedes the first item. Otherwise it is a line we could not read.
      const header = text.match(HEADER);
      const candidate = cleanName(header ? header[1] : text);
      // A line carrying digits is not a category name — it is a dish whose price
      // we failed to read. Turning it into a header would swallow the item.
      const usableAsHeader = candidate.length > 0 && !/\d/.test(candidate);
      if (usableAsHeader && (header || !lastWasItem)) {
        category = candidate;
        return;
      }
      errors.push({ line: lineNo, raw, reason: 'no-price' });
      return;
    }

    const price = toPrice(match[1]);
    if (price === null) {
      errors.push({ line: lineNo, raw, reason: 'bad-price' });
      return;
    }

    const name = cleanName(text.slice(0, match.index ?? 0));
    if (!name) {
      errors.push({ line: lineNo, raw, reason: 'empty-name' });
      return;
    }

    items.push({ name, price, category, line: lineNo });
    lastWasItem = true;
  });

  return { items, errors };
}

function toPrice(token: string | undefined): number | null {
  if (!token) return null;
  const value = Number(token.replace(',', '.'));
  if (!Number.isFinite(value) || value < 0 || value > 100_000) return null;
  // Prices are stored at 3 decimals (BHD/KWD); round before the insert so the
  // preview the owner approves is exactly what gets written.
  return Math.round(value * 1000) / 1000;
}
