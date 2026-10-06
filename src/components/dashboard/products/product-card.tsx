'use client';

// FIX-C-003 (audit 2.4): ProductCard — extracted verbatim from
// products-client.tsx. Grid card: 4:3 image/placeholder, bulk-select ring,
// "متوقف" badge, name/description/price, addon chips. No behavior change.
import Image from 'next/image';
import { ImageIcon, Check } from 'lucide-react';
import { formatMoney } from '@/lib/utils';
import { isSoldOut, remainingStock } from '@/lib/product-stock';
import type { Product, ProductAddon } from '@/lib/types';

export type ProductWithAddons = Product & { product_addons: ProductAddon[] };

export function ProductCard({
  product: p,
  currency,
  bulkMode,
  selected,
  onOpen,
  onToggleSelect,
}: {
  product: ProductWithAddons;
  currency: string;
  bulkMode: boolean;
  selected: boolean;
  onOpen: () => void;
  onToggleSelect: () => void;
}) {
  // Stock (0018): a tracked product with nothing left reads as unavailable to
  // the merchant too, without touching their manual «متاح للطلب» switch.
  const left = remainingStock(p);
  const sold = isSoldOut(p);
  return (
    <div
      key={p.id}
      role={bulkMode ? undefined : 'button'}
      tabIndex={bulkMode ? undefined : 0}
      onClick={bulkMode ? undefined : onOpen}
      onKeyDown={
        bulkMode
          ? undefined
          : (e) => {
              if (e.key === 'Enter' || e.key === ' ') {
                e.preventDefault();
                onOpen();
              }
            }
      }
      aria-label={bulkMode ? undefined : `تعديل ${p.name}`}
      className={`dashboard-card card overflow-hidden text-start transition-all active:scale-[0.98] ${
        bulkMode && selected ? 'ring-2 ring-[var(--color-primary)]' : ''
      } ${sold ? 'opacity-60' : ''}`}
    >
      {/* Image / placeholder — 4:3 like the POS grid. surface so no-image
          cards read as one clean card instead of bleeding into the page bg */}
      <div className="relative aspect-[4/3] w-full overflow-hidden bg-[var(--color-surface)]">
        {p.image_url ? (
          <Image
            src={p.image_url}
            alt={p.name}
            fill
            sizes="(max-width: 768px) 50vw, 200px"
            className={`object-cover ${
              sold ? 'grayscale' : ''
            }`}
          />
        ) : (
          <div className="flex h-full w-full items-center justify-center text-[var(--color-text-muted)]">
            <ImageIcon className="h-7 w-7" />
          </div>
        )}
        {bulkMode ? (
          <button
            type="button"
            onClick={onToggleSelect}
            aria-label={`اختيار ${p.name}`}
            className={`absolute start-2 top-2 flex h-11 w-11 items-center justify-center rounded-full border-2 bg-[var(--color-surface)] transition-colors ${
              selected
                ? 'border-[var(--color-primary)] bg-[var(--color-primary)] text-white'
                : 'border-[var(--color-border)] text-transparent'
            }`}
          >
            <Check className="h-5 w-5" />
          </button>
        ) : !p.is_available ? (
          <span className="absolute end-2 top-2 rounded-[4px] bg-[var(--color-danger)] px-2 py-0.5 text-[11.5px] font-bold text-[var(--color-surface)]">
            متوقف
          </span>
        ) : left === 0 ? (
          <span className="absolute end-2 top-2 rounded-[4px] bg-[var(--color-danger)] px-2 py-0.5 text-[11.5px] font-bold text-[var(--color-surface)]">
            خلص
          </span>
        ) : left !== null ? (
          <span className="absolute end-2 top-2 rounded-[4px] border border-[var(--color-border-strong)] bg-[var(--color-surface)] px-2 py-0.5 text-[11.5px] font-bold text-[var(--color-text-secondary)]">
            باقي <span dir="ltr">{left}</span>
          </span>
        ) : null}
      </div>

      <div className="p-3">
        <h3 className="line-clamp-1 text-sm font-bold">{p.name}</h3>
        {p.description && (
          <p className="mt-0.5 line-clamp-1 text-[11.5px] text-[var(--color-text-secondary)]">
            {p.description}
          </p>
        )}
        <p className="mt-1 text-sm font-bold tabular-nums text-[var(--color-text)]">
          {formatMoney(Number(p.price), currency)}
        </p>

        {p.product_addons?.length > 0 && (
          <div className="mt-2 flex flex-wrap gap-1">
            {p.product_addons.slice(0, 2).map((a) => (
              <span
                key={a.id}
                className="rounded-full bg-[var(--color-bg)] px-2 py-0.5 text-[11.5px] font-semibold text-[var(--color-text-secondary)]"
              >
                {a.name}
              </span>
            ))}
            {p.product_addons.length > 2 && (
              <span className="rounded-full bg-[var(--color-bg)] px-2 py-0.5 text-[11.5px] font-bold tabular-nums text-[var(--color-primary)]">
                +{p.product_addons.length - 2}
              </span>
            )}
          </div>
        )}
      </div>
    </div>
  );
}
