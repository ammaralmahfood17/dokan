import { describe, expect, it } from 'vitest';
import {
  MENU_TEMPLATES,
  MENU_TEMPLATE_IDS,
  isMenuTemplateId,
  templatePrice,
} from '@/lib/menu-templates';

describe('menu templates', () => {
  it('exposes exactly the three advertised starters', () => {
    expect(MENU_TEMPLATE_IDS).toEqual(['coffee', 'tea', 'juice']);
  });

  it('every template has at least two categories and priced items', () => {
    for (const id of MENU_TEMPLATE_IDS) {
      const t = MENU_TEMPLATES[id];
      expect(t.categories.length).toBeGreaterThanOrEqual(2);
      for (const category of t.categories) {
        expect(category.items.length).toBeGreaterThan(0);
        for (const item of category.items) {
          expect(item.name.length).toBeGreaterThan(1);
          expect(item.nameEn.length).toBeGreaterThan(1);
          expect(item.price).toBeGreaterThan(0);
        }
      }
    }
  });

  it('has no duplicate item name inside one category (a duplicate would confuse the menu)', () => {
    for (const id of MENU_TEMPLATE_IDS) {
      for (const category of MENU_TEMPLATES[id].categories) {
        const names = category.items.map((i) => i.name);
        expect(new Set(names).size).toBe(names.length);
      }
    }
  });

  it('scales BHD prices to the store currency', () => {
    expect(templatePrice(1.3, 'BHD')).toBe(1.3);
    expect(templatePrice(1.3, 'SAR')).toBe(13);
    expect(templatePrice(1.3, 'KWD')).toBe(0.975);
    expect(templatePrice(1.3, 'QAR')).toBe(13);
  });

  it('treats an unknown currency as BHD rather than inventing a factor', () => {
    expect(templatePrice(1, 'XYZ')).toBe(1);
  });

  it('recognises only real template ids', () => {
    expect(isMenuTemplateId('coffee')).toBe(true);
    expect(isMenuTemplateId('pizza')).toBe(false);
    expect(isMenuTemplateId(null)).toBe(false);
    expect(isMenuTemplateId(3)).toBe(false);
  });
});
