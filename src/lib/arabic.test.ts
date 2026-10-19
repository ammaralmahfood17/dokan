import { describe, expect, it } from 'vitest';
import { arabicNewOrders } from '@/lib/arabic';

describe('arabicNewOrders()', () => {
  it('is silent at zero', () => {
    expect(arabicNewOrders(0)).toBe('');
  });

  it('uses the singular for one', () => {
    expect(arabicNewOrders(1)).toContain('طلب جديد');
  });

  it('uses the dual for two', () => {
    expect(arabicNewOrders(2)).toBe('وصل طلبان جديدان');
  });

  it('uses the plural (3–10)', () => {
    expect(arabicNewOrders(3)).toBe('وصلت 3 طلبات جديدة');
    expect(arabicNewOrders(10)).toBe('وصلت 10 طلبات جديدة');
  });

  it('uses the singular accusative for 11+', () => {
    expect(arabicNewOrders(11)).toBe('وصل 11 طلباً جديداً');
    expect(arabicNewOrders(100)).toBe('وصل 100 طلباً جديداً');
  });

  it('keys on the last two digits, so 103 behaves like 3', () => {
    expect(arabicNewOrders(103)).toBe('وصلت 103 طلبات جديدة');
  });
});
