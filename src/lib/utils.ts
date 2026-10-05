import { type ClassValue, clsx } from 'clsx';
import { twMerge } from 'tailwind-merge';

/** Merge Tailwind classes safely */
export function cn(...inputs: ClassValue[]) {
  return twMerge(clsx(inputs));
}

/**
 * Generate a URL-safe slug from Arabic or English text.
 * Improved version:
 * - Better Arabic transliteration
 * - Removes common filler words for nicer slugs (مقهى, cafe, store, etc.)
 * - Shorter output
 * - Falls back to short random
 */
export function generateSlug(input: string): string {
  const arabicToLatin: Record<string, string> = {
    ا: 'a', أ: 'a', إ: 'i', آ: 'a', ب: 'b', ت: 't', ث: 'th',
    ج: 'j', ح: 'h', خ: 'kh', د: 'd', ذ: 'dh', ر: 'r', ز: 'z',
    س: 's', ش: 'sh', ص: 's', ض: 'd', ط: 't', ظ: 'z', ع: 'a',
    غ: 'gh', ف: 'f', ق: 'q', ك: 'k', ل: 'l', م: 'm', ن: 'n',
    ه: 'h', و: 'w', ي: 'y', ى: 'a', ة: 'h', ء: '', ئ: 'y', ؤ: 'w',
    '٠': '0', '١': '1', '٢': '2', '٣': '3', '٤': '4',
    '٥': '5', '٦': '6', '٧': '7', '٨': '8', '٩': '9',
  };

  let s = (input || '').trim().toLowerCase();

  // Remove common filler words for cleaner slugs
  s = s.replace(/\b(cafe|coffee|shop|store|متجر|مقهى|مطعم|restaurant|café)\b/gi, '');

  s = s
    .split('')
    .map((ch) => arabicToLatin[ch] ?? ch)
    .join('');

  s = s
    .normalize('NFKD')
    .replace(/[\u0300-\u036f]/g, '')
    .replace(/[^a-z0-9]+/g, '-')
    .replace(/^-+|-+$/g, '')
    .replace(/-{2,}/g, '-');

  if (!s) {
    s = `store-${Math.random().toString(36).slice(2, 8)}`;
  }

  return s.slice(0, 40);
}

/**
 * Suggest a unique slug by appending -1, -2... against a list of existing slugs.
 * Lightweight helper for better default suggestions.
 */
/** Decimal places per currency (Gulf): BHD/KWD/OMR = 3, others = 2. */
export const CURRENCY_DECIMALS: Record<string, number> = {
  BHD: 3,
  KWD: 3,
  OMR: 3,
  SAR: 2,
  AED: 2,
  QAR: 2,
};

/** Currency-aware decimals (defaults to 2 for unknown currencies). */
export function currencyDecimals(currency: string): number {
  return CURRENCY_DECIMALS[currency.toUpperCase()] ?? 2;
}

/**
 * Round money to the given decimal places (default 3 = BHD standard).
 * Returns 0 for non-finite. Always pass `decimals` for non-BHD currencies —
 * writing SAR/AED/QAR amounts at 3 decimals persists wrong prices.
 */
export function money(value: number, decimals = 3): number {
  if (!Number.isFinite(value)) return 0;
  const factor = 10 ** decimals;
  const rounded = Math.round((value + Number.EPSILON) * factor) / factor;
  // A tiny negative amount (-0.0001) rounds to NEGATIVE ZERO, and
  // `Intl.NumberFormat` renders that as "-0.000 BHD" on a customer receipt.
  // `rounded || 0` normalises -0 to 0 while leaving every other value alone
  // (including real negatives, which are legitimate refunds).
  return rounded || 0;
}

// AR-1: locale عربي لكل عملة خليجية — الأرقام تُثبَّت لاتينية (0-9) عبر
// لاحقة -u-nu-latn إجباريًا (لا ٠١٢ هندية). النص المحيط يبقى عربيًا.
const CURRENCY_LOCALES: Record<string, string> = {
  BHD: 'ar-BH-u-nu-latn',
  KWD: 'ar-KW-u-nu-latn',
  OMR: 'ar-OM-u-nu-latn',
  SAR: 'ar-SA-u-nu-latn',
  AED: 'ar-AE-u-nu-latn',
  QAR: 'ar-QA-u-nu-latn',
};

// AR-1: cache المنسّق لكل (عملة × خانات) — formatMoney يُستدعى بكثرة في POS
// والقائمة العامة ولوحة التحكم (لا نعيد إنشاء Intl.NumberFormat كل مرة).
const moneyFormatterCache = new Map<string, Intl.NumberFormat>();

function getMoneyFormatter(currency: string, decimals: number): Intl.NumberFormat {
  const key = `${currency}:${decimals}`;
  let fmt = moneyFormatterCache.get(key);
  if (!fmt) {
    const locale = CURRENCY_LOCALES[currency.toUpperCase()] ?? 'ar-BH-u-nu-latn';
    fmt = new Intl.NumberFormat(locale, {
      minimumFractionDigits: decimals,
      maximumFractionDigits: decimals,
    });
    moneyFormatterCache.set(key, fmt);
  }
  return fmt;
}

/** Format money for display with currency code (currency-aware decimals).
 * AR-1: Intl.NumberFormat بلوكيل عربي (ar-BH/ar-KW/...) مع numberingSystem
 * لاتيني إجباري — الأرقام تظهر 0-9 دائمًا، الصياغة والوحدة تبقى عربية. */
export function formatMoney(value: number, currency = 'BHD'): string {
  const decimals = currencyDecimals(currency);
  const n = Number.isFinite(value) ? money(value, decimals) : 0;
  const formatted = getMoneyFormatter(currency, decimals).format(n);
  return `${formatted} ${currency}`;
}

/**
 * Public menu URL. `tableToken` is the table's 128-bit scan token (tables.qrcode) and is
 * what the printed QR encodes — it is REQUIRED for ordering (audit 2026-10-05, T2 #1).
 * Omitting it yields a browse-only link, which the storefront's table picker still uses.
 */
export function menuPath(projectSlug: string, tableSlug: string, tableToken?: string): string {
  const path = `/${projectSlug}/menu/${tableSlug}`;
  return tableToken ? `${path}?k=${encodeURIComponent(tableToken)}` : path;
}

/** Default table slug from table number */
export function tableSlugFromNumber(number: number): string {
  return `table-${number}`;
}

/** Generate a random QR secret token */
export function generateQrToken(): string {
  if (typeof crypto !== 'undefined' && crypto.randomUUID) {
    return crypto.randomUUID().replace(/-/g, '');
  }
  // B8: CSPRNG fallback — Math.random() is not cryptographically secure and
  // must never back a secret token (predictable = forgeable table QR links).
  const buf = new Uint8Array(16);
  crypto.getRandomValues(buf);
  return Array.from(buf, (b) => b.toString(16).padStart(2, '0')).join('');
}

/** Reserved slugs that cannot be used as project slugs */
export const RESERVED_SLUGS = new Set([
  'api',
  'login',
  'register',
  'onboarding',
  'dashboard',
  'admin',
  'auth',
  'kitchen',
  'pos',
  'settings',
  'products',
  'tables',
  'orders',
  'menu',
  'public',
  'assets',
  'icons',
]);
export function isReservedSlug(slug: string): boolean {
  return RESERVED_SLUGS.has(slug.toLowerCase());
}
