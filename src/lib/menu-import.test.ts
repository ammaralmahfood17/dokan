import { describe, expect, it } from 'vitest';
import { normalizeDigits, parseMenuText } from './menu-import';

/**
 * The menu importer is the merchant's first five minutes with Dokan: they paste
 * the menu they already have (a Word doc, a WhatsApp message, an Instagram
 * caption) and expect products. These tests pin the shapes we accept, because a
 * silently dropped dish is worse than a rejected line — the owner only sees the
 * preview once.
 */

describe('normalizeDigits', () => {
  it('converts Arabic-Indic and extended Arabic-Indic digits', () => {
    expect(normalizeDigits('١٢٣')).toBe('123');
    expect(normalizeDigits('۴۵۶')).toBe('456');
    expect(normalizeDigits('سعر ٢.٥٠٠ د.ب')).toBe('سعر 2.500 د.ب');
  });
});

describe('parseMenuText', () => {
  it('reads name + price with a space separator', () => {
    const { items, errors } = parseMenuText('شاورما دجاج 1.500');
    expect(errors).toEqual([]);
    expect(items).toEqual([{ name: 'شاورما دجاج', price: 1.5, category: null, line: 1 }]);
  });

  it('reads a dash separator, currency marker and Arabic digits', () => {
    const { items } = parseMenuText('برجر لحم — ٢.٢٥٠ د.ب');
    expect(items[0]).toMatchObject({ name: 'برجر لحم', price: 2.25 });
  });

  it('reads the three-column shape and carries the category forward', () => {
    const { items } = parseMenuText(['شاورما | 1.500 | ساندويتشات', 'برجر | 2.200'].join('\n'));
    expect(items.map((i) => i.category)).toEqual(['ساندويتشات', 'ساندويتشات']);
  });

  it('treats marked and leading unpriced lines as category headers', () => {
    const { items, errors } = parseMenuText(
      ['== مشروبات ==', 'عصير برتقال 0.800', '[حلويات]', 'كنافة 1.200'].join('\n'),
    );
    expect(errors).toEqual([]);
    expect(items.map((i) => i.category)).toEqual(['مشروبات', 'حلويات']);
  });

  it('reports an unpriced line in the middle instead of dropping it silently', () => {
    const { items, errors } = parseMenuText(['شاي 0.300', 'ملاحظة مهمة', 'قهوة 0.500'].join('\n'));
    expect(items).toHaveLength(2);
    expect(errors).toEqual([{ line: 2, raw: 'ملاحظة مهمة', reason: 'no-price' }]);
  });

  it('rejects a malformed price with its line number', () => {
    const { items, errors } = parseMenuText('عصير 1.2.3');
    expect(items).toEqual([]);
    expect(errors[0]).toMatchObject({ line: 1, reason: 'no-price' });
  });

  it('rejects an out-of-range price', () => {
    const { items, errors } = parseMenuText('ذهب 999999');
    expect(items).toEqual([]);
    expect(errors[0]).toMatchObject({ line: 1, reason: 'bad-price' });
  });

  it('ignores blank lines and keeps source line numbers', () => {
    const { items } = parseMenuText('\n\nشاي 0.300\n\n');
    expect(items[0]).toMatchObject({ name: 'شاي', line: 3 });
  });

  it('rounds to the currency precision the database stores', () => {
    const { items } = parseMenuText('شاي 0.3335');
    expect(items[0]?.price).toBe(0.334);
  });

  it('handles a trailing column separator without losing the dish', () => {
    const { items } = parseMenuText('شاورما 1.500 |');
    expect(items[0]).toMatchObject({ name: 'شاورما', price: 1.5 });
  });
});
