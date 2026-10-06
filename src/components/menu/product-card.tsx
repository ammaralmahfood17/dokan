'use client';

// D2: Public menu product row — extracted from menu-client.tsx renderProduct().
// D4: the card's content is a real <button> for keyboard access; the add /
// stepper controls are separate 44px touch targets (Calm Surface mockup:
// bordered grid card with a circle add button that becomes a stepper).
// v1.1 Calm Surface: borders instead of shadows, indigo restricted to the
// add control, tabular Latin numerals for the price.
import Image from 'next/image';
import { Check, Minus, Plus, X } from 'lucide-react';
import { formatMoney } from '@/lib/utils';
import { langOfText } from '@/lib/i18n';
import { isSoldOut, lowStockLabel, maxOrderableQty } from '@/lib/product-stock';
import type { Product, ProductAddon } from '@/lib/types';

/** Generic blur placeholder for product images — tiny 16×16 grey base64 */
const BLUR_PLACEHOLDER =
  'data:image/png;base64,iVBORw0KGgoAAAANSUhEUgAAABAAAAAQCAYAAAAf8/9hAAAAMklEQVQ4T2NkYPj/n4EBBJgYKAQMFFiAKcBAUwsDUx0DxS5gYKA8DCh2AQNlYUBZCgDxpwgRg9RXOAAAAABJRU5ErkJggg==';

export type MenuProduct = Product & { product_addons: ProductAddon[] };

export function MenuProductRow({
  product,
  currency,
  isFirst,
  lastAdded,
  quantity,
  displayName,
  onQuickAdd,
  onDecrement,
}: {
  product: MenuProduct;
  currency: string;
  isFirst: boolean;
  lastAdded: boolean;
  /** Current qty of this product in the cart (0 = add circle, >0 = stepper). */
  quantity: number;
  /** Name in the active language (ar default, en when available + toggled). */
  displayName: string;
  onQuickAdd: (p: MenuProduct) => void;
  onDecrement: () => void;
}) {
  // UX-6: sold-out items stay visible, greyed, with a «غير متوفر» badge —
  // customers shouldn't conclude the store shrank when an item is marked
  // unavailable. Ordering is blocked both here and server-side (order API).
  // 0018: a tracked product with no portions left reads as sold out too.
  const soldOut = isSoldOut(product);
  // «باقي N» — only while it is still orderable and the count is low enough to
  // matter (lowStockLabel returns null for untracked / sold-out / plenty).
  const remaining = lowStockLabel(product);
  const atMax = quantity >= maxOrderableQty(product);
  return (
    <div className="relative flex flex-col overflow-hidden rounded-[var(--radius-lg)] border border-[var(--color-border)] bg-[var(--color-surface)] transition-colors duration-150 hover:border-[var(--color-border-strong)]">
      {soldOut && (
        <span className="absolute start-2 top-2 z-10 rounded-full bg-[var(--color-text)] px-2.5 py-1 text-[11px] font-bold text-white">
          غير متوفر
        </span>
      )}
      {!soldOut && remaining !== null && (
        <span className="absolute end-2 top-2 z-10 rounded-full border border-[var(--color-border-strong)] bg-[var(--color-surface)] px-2 py-0.5 text-[10.5px] font-bold text-[var(--color-text-secondary)]">
          باقي <span dir="ltr">{remaining}</span>
        </span>
      )}
      <button
        type="button"
        onClick={() => (soldOut ? undefined : onQuickAdd(product))}
        aria-label={soldOut ? `${displayName} — غير متوفر` : `إضافة ${displayName} إلى السلة`}
        aria-disabled={soldOut}
        className={`flex min-w-0 flex-col text-start ${soldOut ? 'cursor-default' : ''}`}
      >
        {product.image_url ? (
          <Image
            src={product.image_url}
            alt={displayName}
            width={400}
            height={328}
            priority={isFirst}
            placeholder="blur"
            blurDataURL={BLUR_PLACEHOLDER}
            sizes="(max-width: 480px) 50vw, 33vw"
            className={`aspect-[1/0.82] w-full bg-[var(--color-surface-sunken)] object-cover ${
              soldOut ? 'opacity-50 grayscale' : ''
            }`}
          />
        ) : (
          <div
            className={`flex aspect-[1/0.82] w-full items-center justify-center bg-[var(--color-surface-sunken)] text-[12.5px] font-bold text-[var(--color-text-tertiary)] ${
              soldOut ? 'opacity-50' : ''
            }`}
          >
            صورة الصنف
          </div>
        )}
        <div className={`flex min-w-0 flex-1 flex-col gap-1 px-3 pt-2.5 ${soldOut ? 'opacity-60' : ''}`}>
          {/* audit T1 #8: `displayName` is the English `name_en` when the toggle is EN, so an
              Arabic page can hold English text. Marked per element by the text's own script. */}
          <h3 lang={langOfText(displayName)} className="line-clamp-2 text-[14.5px] font-bold leading-[1.4]">
            {displayName}
          </h3>
          {product.description && (
            <p className="line-clamp-2 text-[12.5px] leading-[1.55] text-[var(--color-text-secondary)]">
              {product.description}
            </p>
          )}
        </div>
      </button>
      <div className="flex items-center justify-between gap-2 px-3 pb-3 pt-2">
        <span className="font-mono text-[14px] font-bold tabular-nums text-[var(--color-text)]" dir="ltr">
          {formatMoney(Number(product.price), currency)}
        </span>
        {soldOut ? (
          <span
            role="presentation"
            className="flex h-11 w-11 shrink-0 items-center justify-center rounded-full bg-[var(--color-surface-sunken)] text-[var(--color-text-muted)]"
          >
            <X className="h-5 w-5" />
          </span>
        ) : quantity === 0 ? (
          <button
            type="button"
            onClick={() => onQuickAdd(product)}
            aria-label={`إضافة ${displayName} إلى السلة`}
            className="flex h-11 w-11 shrink-0 items-center justify-center rounded-full bg-[var(--color-primary-tint)] text-[var(--color-primary)] transition-colors duration-150 hover:bg-[var(--color-primary)] hover:text-white active:scale-95"
          >
            {lastAdded ? <Check className="h-5 w-5" /> : <Plus className="h-5 w-5" />}
          </button>
        ) : (
          <div className="flex h-11 shrink-0 items-center overflow-hidden rounded-full bg-[var(--color-primary)] text-white">
            <button
              type="button"
              onClick={onDecrement}
              aria-label={`إنقاص كمية ${displayName}`}
              className="flex h-11 w-11 items-center justify-center transition-colors hover:bg-white/15"
            >
              <Minus className="h-4 w-4" />
            </button>
            <span className="min-w-5 text-center text-[13.5px] font-bold tabular-nums">
              {quantity}
            </span>
            <button
              type="button"
              onClick={() => onQuickAdd(product)}
              disabled={atMax}
              aria-disabled={atMax}
              aria-label={`زيادة كمية ${displayName}`}
              className="flex h-11 w-11 items-center justify-center transition-colors hover:bg-white/15 disabled:cursor-not-allowed disabled:opacity-40"
            >
              <Plus className="h-4 w-4" />
            </button>
          </div>
        )}
      </div>
    </div>
  );
}
