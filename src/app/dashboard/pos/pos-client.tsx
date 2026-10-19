'use client';

import { useCallback, useEffect, useMemo, useRef, useState, type ComponentProps } from 'react';
import { lockBodyScroll } from '@/lib/use-body-scroll-lock';
import { Check, Search, ShoppingBag, X } from 'lucide-react';
import { createClient } from '@/lib/supabase/client';
import { formatMoney, money, currencyDecimals } from '@/lib/utils';
import type { OrderType, Product, ProductOptionGroup, ProductWithOptions } from '@/lib/types';
import {
  availableChoices,
  effectiveBounds,
  selectedChoices,
  validateOptionSelection,
} from '@/lib/product-options';
import { Button } from '@/components/ui/button';
import { CartPanel } from '@/components/pos/cart-panel';
import { PosProductGrid } from '@/components/pos/pos-product-grid';
import { PosMobileCart } from '@/components/pos/pos-mobile-cart';
import { PosOrderConfirmed } from '@/components/pos/pos-order-confirmed';
import { PosAddonPicker } from '@/components/pos/pos-addon-picker';
import { ProductCard } from '@/components/pos/product-card';
import type { PosLine } from '@/components/pos/types';
import { toast } from 'sonner';
import { isSoldOut } from '@/lib/product-stock';
import { cartTotal, needsPicker, productQtyInCart, toggleOptionSelection } from '@/lib/menu-cart';
import {
  addPosLine,
  availablePosProducts,
  buildPosLine,
  changePosQty,
  posStockCheck,
  searchPosProducts,
  filterPosByCategory,
  setPosQty,
} from '@/lib/pos-cart';


const ORDER_TYPES: [OrderType, string][] = [
  ['walkin', 'سفري'],
  ['drivethru', 'سيارة'],
  ['dinein', 'طاولة'],
];

export function PosClient({
  projectId,
  currency,
  products,
  productFrequency,
  categories = [],
}: {
  projectId: string;
  currency: string;
  products: ProductWithOptions[];
  /** UX-U12: تكرار طلبات آخر 7 أيام لكل منتج — لتصدر الأكثر طلبًا */
  productFrequency?: Record<string, number>;
  /** Menu categories for the cashier filter (UX-17). */
  categories?: { id: string; name: string }[];
}) {
  const [type, setType] = useState<OrderType>('walkin');
  const [lines, setLines] = useState<PosLine[]>([]);
  const [notes, setNotes] = useState('');
  const [submitting, setSubmitting] = useState(false);
  const [picker, setPicker] = useState<ProductWithOptions | null>(null);
  const [selectedOptions, setSelectedOptions] = useState<string[]>([]);
  const [cartOpen, setCartOpen] = useState(false);
  const [query, setQuery] = useState('');
  const [category, setCategory] = useState<string | null>(null);
  // Last successful order — drives the "وصل المطبخ" confirmation banner.
  const [lastConfirmed, setLastConfirmed] = useState<{
    orderNumber: number;
    totalAmount: number;
  } | null>(null);
  const pickerRef = useRef<HTMLDivElement>(null);
  const searchRef = useRef<HTMLInputElement>(null);

  const pickerKeyDown = useCallback((e: KeyboardEvent) => {
    if (e.key === 'Escape') { setPicker(null); return; }
    if (e.key !== 'Tab') return;
    const el = pickerRef.current;
    if (!el) return;
    const focusable = el.querySelectorAll<HTMLElement>(
      'button, [href], input, select, textarea, [tabindex]:not([tabindex="-1"])'
    );
    if (focusable.length === 0) return;
    const first = focusable[0];
    const last = focusable[focusable.length - 1];
    if (e.shiftKey && document.activeElement === first) { e.preventDefault(); last?.focus(); }
    else if (!e.shiftKey && document.activeElement === last) { e.preventDefault(); first?.focus(); }
  }, []);

  // Scroll lock + keyboard trap while ANY overlay (addon picker, cart sheet) is open
  useEffect(() => {
    if (!picker && !cartOpen) return;
    document.addEventListener('keydown', pickerKeyDown);
    // Scroll lock (iOS-safe) — one implementation, lib/use-body-scroll-lock.
    const unlockBody = lockBodyScroll();
    return () => {
      document.removeEventListener('keydown', pickerKeyDown);
      unlockBody();
    };
  }, [picker, cartOpen, pickerKeyDown]);

  // UX-U12: ترتيب الأكثر طلبًا أولًا (آخر 7 أيام) — يحافظ على sort_order كـ
  // tiebreaker للاستقرار. القاعدة نفسها في lib/pos-cart (نقية ومختبَرة).
  const available = useMemo(
    () => availablePosProducts(products, productFrequency),
    [products, productFrequency]
  );

  // Cashier search — filters by Arabic/English name; Enter quick-adds the top
  // hit. `q` is kept for the empty state: "no match" and "no products" are
  // different messages to a cashier.
  const q = query.trim().toLowerCase();
  const inCategory = useMemo(() => filterPosByCategory(available, category), [available, category]);
  const filtered = useMemo(() => searchPosProducts(inCategory, query), [inCategory, query]);

  // Cashier keyboard shortcuts (desktop): "/" focuses search, Enter in the
  // search field quick-adds the top filtered product (addon products open the
  // picker — same behavior as tapping the card).
  const onSearchKeyDown = useCallback(
    (e: React.KeyboardEvent<HTMLInputElement>) => {
      if (e.key === 'Enter') {
        const hit = filtered[0];
        if (!hit) return;
        e.preventDefault();
        openProduct(hit);
      }
    },
    // eslint-disable-next-line react-hooks/exhaustive-deps
    [filtered, openProduct, picker, cartOpen]
  );

  useEffect(() => {
    const onKey = (e: KeyboardEvent) => {
      if (picker || cartOpen) return;
      if (e.key === '/' && document.activeElement?.tagName !== 'INPUT') {
        e.preventDefault();
        searchRef.current?.focus();
      }
    };
    document.addEventListener('keydown', onKey);
    return () => document.removeEventListener('keydown', onKey);
  }, [picker, cartOpen]);

  const total = useMemo(() => cartTotal(lines, currency), [lines, currency]);

  // ---- Picker: the groups that actually have a pickable variety, and the one
  // reason «إضافة للسلة» is still disabled. Same rules module as the API.
  const pickerGroups = picker
    ? (picker.option_groups || []).filter((g) => availableChoices(g).length > 0)
    : [];
  const pickerViolation = picker
    ? validateOptionSelection(picker.option_groups || [], selectedOptions)
    : null;

  function openProduct(p: ProductWithOptions) {
    // The picker is needed whenever the product has a group with a pickable
    // variety — the cashier must choose before the line can be priced.
    if (needsPicker(p)) {
      setPicker(p);
      setSelectedOptions([]);
    } else {
      addLine(p, [], [], 1, false);
    }
  }

  function addLine(
    p: ProductWithOptions,
    optionIds: string[],
    addonLabels: string[],
    qty = 1,
    silent = false
  ) {
    // Stock (0018). A tracked product with nothing left reads as unavailable,
    // and no sale may exceed what remains — the server rejects the WHOLE order
    // at checkout, so it has to be caught here where the cashier can react.
    // Guard + price + key live in lib/pos-cart (pure, tested). A miss here is a
    // sale the SERVER rejects at checkout, in front of a queue.
    const check = posStockCheck(p, productQtyInCart(lines, p.id), qty);
    if (!check.ok) {
      if (!silent) toast.error(check.message);
      return;
    }
    const line = buildPosLine(p, optionIds, addonLabels, qty, currency);
    setLines((prev) => addPosLine(prev, line, qty));
    if (!silent) toast.success('تمت الإضافة إلى السلة');
    setPicker(null);
  }

  function confirmOptions() {
    if (!picker) return;
    const groups = picker.option_groups || [];
    const violation = validateOptionSelection(groups, selectedOptions);
    if (violation) {
      toast.error(violation.message);
      return;
    }
    addLine(
      picker,
      selectedOptions,
      selectedChoices(groups, selectedOptions).map((c) => c.name)
    );
  }

  /** Single-choice groups replace; multi groups append up to their max.
   *  The menu's rule, shared — the two surfaces must not disagree. */
  function toggleOption(group: ProductOptionGroup, choiceId: string) {
    setSelectedOptions((prev) => toggleOptionSelection(prev, group, choiceId));
  }

  // ---------- Quick action: repeat last order ----------
  // One tap restores the previous (non-cancelled) order's lines into the
  // cart. No modal, no top-sellers query — the cashier's highest-frequency
  // action is re-ordering the same drinks, and this keeps it to a single
  // DB read + fills the cart.
  const [repeatLoading, setRepeatLoading] = useState(false);

  const repeatLastOrder = useCallback(async () => {
    if (repeatLoading) return;
    setRepeatLoading(true);
    try {
      const supabase = createClient();
      const { data: last } = await supabase
        .from('orders')
        .select('order_number, order_items(product_id, quantity, addons)')
        .eq('project_id', projectId)
        .is('service_type', null)
        .not('status', 'eq', 'cancelled')
        .order('created_at', { ascending: false })
        .limit(1)
        .maybeSingle();
      const items = (last?.order_items ?? []) as {
        product_id: string | null;
        quantity: number;
        addons: { id: string; name: string }[] | null;
      }[];
      if (!items.length) {
        toast.error('ما فيه طلب سابق قابل للتكرار');
        return;
      }
      let added = 0;
      for (const it of items) {
        const p = products.find((x) => x.id === it.product_id);
        if (!p || !p.is_available) continue;
        const optionIds = (it.addons ?? []).map((a) => a.id);
        const labels = (it.addons ?? []).map((a) => a.name);
        addLine(p, optionIds, labels, it.quantity, true);
        added += 1;
      }
      toast.success(
        added > 0
          ? `تمت إعادة الطلب — ${added} صنف`
          : 'المنتجات غير متاحة حالياً'
      );
    } catch {
      toast.error('تعذّر جلب آخر طلب');
    } finally {
      setRepeatLoading(false);
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [repeatLoading, projectId, products]);

  function updateQty(key: string, delta: number) {
    setLines((prev) => changePosQty(prev, key, delta));
  }

  function setQty(key: string, qty: number) {
    setLines((prev) => setPosQty(prev, key, qty));
  }

  async function submit() {
    if (!lines.length) {
      toast.error('السلة فارغة');
      return;
    }
    setSubmitting(true);
    try {
      const res = await fetch('/api/pos/order', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          projectId,
          type,
          notes: notes.trim() || undefined,
          items: lines.map((l) => ({
            productId: l.productId,
            quantity: l.quantity,
            optionIds: l.optionIds,
          })),
        }),
      });
      const data = (await res.json()) as {
        error?: string;
        order?: { id: string; totalAmount: number; orderNumber: number };
      };
      if (!res.ok) {
        console.error('[POS] Order creation failed', { error: data.error, type, itemCount: lines.length });
        toast.error(data.error || 'فشل إنشاء الطلب');
        return;
      }
      toast.success(
        `تم الطلب order-${data.order?.orderNumber} — ${formatMoney(
          data.order?.totalAmount ?? total,
          currency
        )}`
      );
      setLines([]);
      setNotes('');
      setCartOpen(false);
      // Confirmation state — shows "الطلب وصل المطبخ" banner + allows
      // repeat-last-order to restore the exact same cart in one tap.
      setLastConfirmed({ orderNumber: data.order?.orderNumber ?? 0, totalAmount: data.order?.totalAmount ?? 0 });
    } catch {
      toast.error('تعذّر الاتصال');
    } finally {
      setSubmitting(false);
    }
  }

  const itemCount = lines.reduce((s, l) => s + l.quantity, 0);

  // ONE props object for both carts: the desktop column and the mobile sheet
  // render the same CartPanel, and a re-listed set of twenty props is exactly
  // how the two drifted apart before.
  const cartPanelProps: ComponentProps<typeof CartPanel> = {
    lines,
    products,
    currency,
    type,
    onTypeChange: setType,
    notes,
    onNotesChange: setNotes,
    onClear: () => setLines([]),
    onRepeat: repeatLastOrder,
    repeatLoading,
    onIncrement: (key) => updateQty(key, 1),
    onDecrement: (key) => updateQty(key, -1),
    onSetQuantity: setQty,
    onAddQuantity: (key, n) => updateQty(key, n),
    onRemove: (key) => setLines((prev) => prev.filter((x) => x.key !== key)),
    onSubmit: submit,
    submitting,
  };

  return (
    <div className="page md:max-w-[1440px]">
      <div className="page-header">
        <div>
          <h1>نقطة البيع</h1>
        </div>
      </div>

      <div data-pos-shell className="md:grid md:grid-cols-[minmax(0,1fr)_380px] md:items-start md:gap-4">
        {/* ── Left: product grid (extracted component, wave 4 phase b) ── */}
        <PosProductGrid
          type={type}
          onTypeChange={setType}
          submitting={submitting}
          query={query}
          onQueryChange={setQuery}
          onSearchKeyDown={onSearchKeyDown}
          searchRef={searchRef}
          products={filtered}
          categories={categories}
          category={category}
          onCategoryChange={setCategory}
          queryIsActive={Boolean(q)}
          currency={currency}
          onSelect={(prod) => openProduct(prod as ProductWithOptions)}
        />

        {/* ── Right: cart panel (desktop, sticky full-height) ─────────── */}
        <aside data-pos-cart className="hidden md:block">
          <div className="md:sticky md:top-[57px] md:h-[calc(100dvh-57px)] lg:top-0 lg:h-dvh">
            <CartPanel {...cartPanelProps} />
          </div>
        </aside>
      </div>

      {/* ── Mobile: cart (extracted component, wave 4 phase b) ───────── */}
      <PosMobileCart
        panel={cartPanelProps}
        itemCount={itemCount}
        total={total}
        currency={currency}
        submitting={submitting}
        open={cartOpen}
        onOpen={() => setCartOpen(true)}
        onClose={() => setCartOpen(false)}
      />

      {/* ── Order-confirmed banner (extracted component) ─────────────── */}
      {lastConfirmed && (
        <PosOrderConfirmed
          order={lastConfirmed}
          currency={currency}
          onDismiss={() => setLastConfirmed(null)}
        />
      )}

      {/* ── Addon picker (extracted component) ───────────────────────── */}
      {picker && (
        <PosAddonPicker
          picker={picker}
          groups={pickerGroups}
          selectedOptionIds={selectedOptions}
          currency={currency}
          violation={pickerViolation}
          panelRef={pickerRef}
          onToggleOption={toggleOption}
          onConfirm={confirmOptions}
          onClose={() => setPicker(null)}
        />
      )}
    </div>
  );
}
