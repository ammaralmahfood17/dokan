/**
 * Starter menus for onboarding.
 *
 * WHY: the promise is «من التسجيل إلى أول طلب في أقل من 7 دقائق». Onboarding created an
 * empty store, so the merchant had to type every product before the QR menu showed
 * anything — the measured friction point in docs/ux-audit.md §2. A template seeds
 * categories + priced items they can edit or delete, turning menu entry into one tap.
 *
 * Prices are authored in BHD (the launch market) and scaled per currency, because the
 * same drink is 0.900 BHD, 10 SAR or 0.750 KWD — a flat copy would be off by 10×.
 */

export const MENU_TEMPLATE_IDS = ['coffee', 'tea', 'juice'] as const;
export type MenuTemplateId = (typeof MENU_TEMPLATE_IDS)[number];

export type TemplateItem = {
  name: string;
  nameEn: string;
  /** Price in BHD; scaled to the store's currency by templateFor(). */
  price: number;
};

export type TemplateCategory = {
  name: string;
  items: TemplateItem[];
};

export type MenuTemplate = {
  label: string;
  hint: string;
  categories: TemplateCategory[];
};

export const MENU_TEMPLATES: Record<MenuTemplateId, MenuTemplate> = {
  coffee: {
    label: 'مقهى',
    hint: 'قهوة ساخنة وباردة + حلويات',
    categories: [
      {
        name: 'قهوة ساخنة',
        items: [
          { name: 'إسبريسو', nameEn: 'Espresso', price: 0.9 },
          { name: 'أمريكانو', nameEn: 'Americano', price: 1.0 },
          { name: 'كابتشينو', nameEn: 'Cappuccino', price: 1.3 },
          { name: 'لاتيه', nameEn: 'Latte', price: 1.4 },
          { name: 'قهوة عربية', nameEn: 'Arabic coffee', price: 0.8 },
        ],
      },
      {
        name: 'قهوة باردة',
        items: [
          { name: 'آيس لاتيه', nameEn: 'Iced latte', price: 1.5 },
          { name: 'فرابتشينو', nameEn: 'Frappuccino', price: 1.7 },
        ],
      },
      {
        name: 'حلويات',
        items: [{ name: 'كرواسان', nameEn: 'Croissant', price: 0.7 }],
      },
    ],
  },
  tea: {
    label: 'شاي وكرك',
    hint: 'شاي، كرك، ومشروبات باردة',
    categories: [
      {
        name: 'شاي',
        items: [
          { name: 'شاي أحمر', nameEn: 'Black tea', price: 0.2 },
          { name: 'شاي كرك', nameEn: 'Karak', price: 0.3 },
          { name: 'شاي أخضر', nameEn: 'Green tea', price: 0.3 },
          { name: 'شاي بالنعناع', nameEn: 'Mint tea', price: 0.3 },
        ],
      },
      {
        name: 'مشروبات باردة',
        items: [
          { name: 'آيس تي', nameEn: 'Iced tea', price: 0.8 },
          { name: 'ليمون بالنعناع', nameEn: 'Lemon mint', price: 0.7 },
        ],
      },
    ],
  },
  juice: {
    label: 'عصائر',
    hint: 'عصائر طازجة، سموذي، وموهيتو',
    categories: [
      {
        name: 'عصائر طازجة',
        items: [
          { name: 'برتقال', nameEn: 'Orange', price: 1.1 },
          { name: 'مانجو', nameEn: 'Mango', price: 1.3 },
          { name: 'ليمون', nameEn: 'Lemon', price: 0.9 },
        ],
      },
      {
        name: 'سموذي',
        items: [
          { name: 'فراولة', nameEn: 'Strawberry', price: 1.4 },
          { name: 'مانجو', nameEn: 'Mango', price: 1.4 },
        ],
      },
      {
        name: 'موهيتو',
        items: [
          { name: 'كلاسيك', nameEn: 'Classic', price: 1.2 },
          { name: 'فراولة', nameEn: 'Strawberry', price: 1.3 },
        ],
      },
    ],
  },
};

export function isMenuTemplateId(value: unknown): value is MenuTemplateId {
  return typeof value === 'string' && (MENU_TEMPLATE_IDS as readonly string[]).includes(value);
}

/** BHD → store currency. Rounded to the currency's decimals by the caller's insert. */
const PRICE_FACTOR: Record<string, number> = {
  BHD: 1,
  KWD: 0.75,
  OMR: 1,
  SAR: 10,
  AED: 10,
  QAR: 10,
};

export function templatePrice(bhdPrice: number, currency: string): number {
  const factor = PRICE_FACTOR[currency.toUpperCase()] ?? 1;
  return Math.round(bhdPrice * factor * 1000) / 1000;
}
