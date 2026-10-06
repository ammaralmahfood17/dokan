'use client';

import { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import { Check, Search, ShoppingBag, X } from 'lucide-react';
import { createClient } from '@/lib/supabase/client';
import { formatMoney, money, currencyDecimals } from '@/lib/utils';
import type { OrderType, Product, ProductOptionGroup } from '@/lib/types';
import {
  availableChoices,
  effectiveBounds,
  selectedChoices,
  validateOptionSelection,
} from '@/lib/product-options';
import { Button } from '@/components/ui/button';
import { CartPanel } from '@/components/pos/cart-panel';
import { ProductCard } from '@/components/pos/product-card';
import type { PosLine } from '@/components/pos/types';
import { toast } from 'sonner';
import { isSoldOut, maxOrderableQty } from '@/lib/product-stock';

type ProductWithOptions = Product & { option_groups: ProductOptionGroup[] };

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
}: {
  projectId: string;
  currency: string;
  products: ProductWithOptions[];
  /** UX-U12: تكرار طلبات آخر 7 أيام لكل منتج — لتصدر الأكثر طلبًا */
  productFrequency?: Record<string, number>;
}) {
  const [type, setType] = useState<OrderType>('walkin');
  const [lines, setLines] = useState<PosLine[]>([]);
  const [notes, setNotes] = useState('');
  const [submitting, setSubmitting] = useState(false);
  const [picker, setPicker] = useState<ProductWithOptions | null>(null);
  const [selectedOptions, setSelectedOptions] = useState<string[]>([]);
  const [cartOpen, setCartOpen] = useState(false);
  const [query, setQuery] = useState('');
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
    const scrollY = window.scrollY;
    document.body.style.position = 'fixed';
    document.body.style.top = `-${scrollY}px`;
    document.body.style.width = '100%';
    document.body.style.overflowY = 'scroll';
    return () => {
      document.removeEventListener('keydown', pickerKeyDown);
      document.body.style.position = '';
      document.body.style.top = '';
      document.body.style.width = '';
      document.body.style.overflowY = '';
      window.scrollTo(0, scrollY);
    };
  }, [picker, cartOpen, pickerKeyDown]);

  const available = useMemo(
    () =>
      // UX-U12: ترتيب الأكثر طلبًا أولًا (آخر 7 أيام) — يحافظ على
      // sort_order كـ tiebreaker للاستقرار
      products
        .filter((p) => !isSoldOut(p))
        .slice()
        .sort(
          (a, b) =>
            (productFrequency?.[b.id] ?? 0) - (productFrequency?.[a.id] ?? 0) ||
            a.sort_order - b.sort_order
        ),
    [products, productFrequency]
  );

  // Cashier search — filters by Arabic/English name; Enter quick-adds the top hit.
  const q = query.trim().toLowerCase();
  const filtered = useMemo(
    () =>
      q
        ? available.filter(
            (p) =>
              p.name.toLowerCase().includes(q) ||
              (p.name_en ?? '').toLowerCase().includes(q)
          )
        : available,
    [available, q]
  );

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

  const total = useMemo(
    () => money(lines.reduce((s, l) => s + l.unitPrice * l.quantity, 0), currencyDecimals(currency)),
    [lines, currency]
  );

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
    if ((p.option_groups || []).some((g) => availableChoices(g).length > 0)) {
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
    if (isSoldOut(p)) {
      if (!silent) toast.error('هذا الصنف غير متوفر');
      return;
    }
    const alreadyInCart = lines
      .filter((l) => l.productId === p.id)
      .reduce((s, l) => s + l.quantity, 0);
    if (alreadyInCart + qty > maxOrderableQty(p)) {
      if (!silent) toast.error('الكمية المطلوبة أكثر من المتوفر');
      return;
    }
    const optionTotal = money(
      selectedChoices(p.option_groups || [], optionIds).reduce((sum, c) => sum + Number(c.price), 0),
      currencyDecimals(currency)
    );
    const unitPrice = money(Number(p.price) + optionTotal, currencyDecimals(currency));
    const key = `${p.id}:${[...optionIds].sort().join(',')}`;
    setLines((prev) => {
      const existing = prev.find((l) => l.key === key);
      if (existing) {
        return prev.map((l) =>
          l.key === key ? { ...l, quantity: l.quantity + qty } : l
        );
      }
      return [
        ...prev,
        {
          key,
          productId: p.id,
          productName: p.name,
          unitPrice,
          quantity: qty,
          optionIds,
          addonLabels,
        },
      ];
    });
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

  /** Single-choice groups replace; multi groups append up to their max. */
  function toggleOption(group: ProductOptionGroup, choiceId: string) {
    const bounds = effectiveBounds(group);
    const groupIds = new Set(availableChoices(group).map((c) => c.id));
    setSelectedOptions((prev) => {
      if (prev.includes(choiceId)) return prev.filter((id) => id !== choiceId);
      if (bounds.max === 1) return [...prev.filter((id) => !groupIds.has(id)), choiceId];
      const picked = availableChoices(group).filter((c) => prev.includes(c.id)).length;
      if (picked >= bounds.max) return prev;
      return [...prev, choiceId];
    });
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
    setLines((prev) =>
      prev
        .map((l) =>
          l.key === key ? { ...l, quantity: l.quantity + delta } : l
        )
        .filter((l) => l.quantity > 0)
    );
  }

  function setQty(key: string, qty: number) {
    setLines((prev) =>
      prev.map((l) => (l.key === key ? { ...l, quantity: qty } : l))
    );
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

  return (
    <div className="page md:max-w-[1440px]">
      <div className="page-header">
        <div>
          <h1>نقطة البيع</h1>
        </div>
      </div>

      <div data-pos-shell className="md:grid md:grid-cols-[minmax(0,1fr)_380px] md:items-start md:gap-4">
        {/* ── Left: product grid ─────────────────────────────────────── */}
        <div className="min-w-0">
          {/* Mobile order type — desktop keeps it in the cart header */}
          {/* audit T1 #15: these are filter buttons over ONE visible region, not tabs with
              panels - role="tab" without panels is a half-implemented pattern that axe flags
              (aria-required-children). aria-pressed matches the other filters in the app. */}
          <div className="mb-3 flex gap-1 rounded-[var(--radius-md)] bg-[var(--color-surface-sunken)] p-1 md:hidden" role="group" aria-label="نوع الطلب">
            {ORDER_TYPES.map(([value, label]) => (
              <button
                key={value}
                type="button"
                aria-pressed={type === value}
                onClick={() => setType(value)}
                disabled={submitting}
                className={`min-h-[44px] flex-1 rounded-[6px] text-sm font-semibold transition-colors ${type === value ? 'bg-[var(--color-surface)] text-[var(--color-text)]' : 'text-[var(--color-text-secondary)] hover:text-[var(--color-text)]'}`}
              >
                {label}
              </button>
            ))}
          </div>

          {/* Cashier search — desktop "/" shortcut, Enter quick-adds top hit */}
          <div className="relative mb-3">
            <Search className="pointer-events-none absolute start-3 top-1/2 h-4 w-4 -translate-y-1/2 text-[var(--color-text-muted)]" />
            <input
              ref={searchRef}
              type="search"
              inputMode="search"
              value={query}
              onChange={(e) => setQuery(e.target.value)}
              onKeyDown={onSearchKeyDown}
              placeholder="ابحث عن منتج… ( / )"
              aria-label="ابحث عن منتج"
              maxLength={60}
              className="input min-h-[44px] w-full ps-10! pe-12!"
              style={{ borderRadius: 'var(--radius-md)' }}
            />
            {query && (
              <button
                type="button"
                onClick={() => setQuery('')}
                aria-label="مسح البحث"
                className="absolute end-0 top-1/2 flex h-11 w-11 -translate-y-1/2 items-center justify-center rounded-full text-[var(--color-text-muted)] hover:bg-[var(--color-surface-sunken)] hover:text-[var(--color-text)]"
              >
                <X className="h-4 w-4" />
              </button>
            )}
          </div>

          {!filtered.length ? (
            <div className="card empty">
              <h3>{q ? 'لا توجد نتائج مطابقة' : 'ما فيه منتجات متاحة حالياً'}</h3>
              <p className="text-sm">
                {q ? `لا يوجد منتج باسم «${query.trim()}».` : 'أضف منتجاتك من صفحة المنتجات.'}
              </p>
            </div>
          ) : (
            <div data-pos-grid className="grid grid-cols-[repeat(auto-fill,minmax(140px,1fr))] gap-3">
              {filtered.map((p) => (
                <ProductCard
                  key={p.id}
                  product={p}
                  currency={currency}
                  onSelect={(prod) => openProduct(prod as ProductWithOptions)}
                />
              ))}
            </div>
          )}
        </div>

        {/* ── Right: cart panel (desktop, sticky full-height) ─────────── */}
        <aside data-pos-cart className="hidden md:block">
          <div className="md:sticky md:top-[57px] md:h-[calc(100dvh-57px)] lg:top-0 lg:h-dvh">
            <CartPanel
              lines={lines}
              products={products}
              currency={currency}
              type={type}
              onTypeChange={setType}
              notes={notes}
              onNotesChange={setNotes}
              onClear={() => setLines([])}
              onRepeat={repeatLastOrder}
              repeatLoading={repeatLoading}
              onIncrement={(key) => updateQty(key, 1)}
              onDecrement={(key) => updateQty(key, -1)}
              onSetQuantity={setQty}
              onAddQuantity={(key, n) => updateQty(key, n)}
              onRemove={(key) => setLines((prev) => prev.filter((x) => x.key !== key))}
              onSubmit={submit}
              submitting={submitting}
            />
          </div>
        </aside>
      </div>

      {/* ── Mobile: floating total bar ───────────────────────────────── */}
      <div data-pos-floating-bar className="fixed inset-x-0 bottom-0 z-[var(--z-drawer)] border-t border-[var(--color-border)] bg-[var(--color-surface)]/95 p-3 pb-safe-bottom backdrop-blur-md md:hidden">
        <button
          type="button"
          onClick={() => setCartOpen(true)}
          disabled={submitting}
          aria-haspopup="dialog"
          aria-label="عرض السلة"
          className="flex min-h-[48px] w-full items-center justify-between gap-3 rounded-[var(--radius-md)] bg-[var(--color-primary)] px-4 text-white transition-colors active:scale-[0.98] hover:bg-[var(--color-primary-hover)]"
        >
          <span className="flex items-center gap-2 text-sm font-semibold">
            <ShoppingBag className="h-4 w-4" />
            {itemCount > 0 ? `${itemCount} قطعة` : 'السلة فارغة'}
          </span>
          <span className="flex items-center gap-1 text-base font-bold tabular-nums">
            {formatMoney(total, currency)}
          </span>
        </button>
      </div>

      {/* ── Mobile: cart bottom sheet ────────────────────────────────── */}
      {cartOpen && (
        <div
          className="fixed inset-0 z-[var(--z-modal)] flex items-end justify-center bg-black/40 md:hidden"
          role="dialog"
          aria-modal="true"
          aria-label="سلة الطلب"
          onClick={(e) => { if (e.target === e.currentTarget) setCartOpen(false); }}
          onKeyDown={(e) => { if (e.key === 'Escape') setCartOpen(false); }}
        >
          <div className="flex h-[85dvh] w-full max-w-lg flex-col overflow-hidden rounded-t-2xl bg-[var(--color-surface)] animate-slide-up">
            <div className="flex items-center justify-between border-b border-[var(--color-border)] px-4 py-2">
              <span className="mx-auto h-1 w-10 rounded-full bg-[var(--color-border)]" aria-hidden="true" />
              <button
                type="button"
                onClick={() => setCartOpen(false)}
                className="btn btn-ghost btn-sm absolute end-3"
                aria-label="إغلاق السلة"
              >
                <X className="h-4 w-4" />
              </button>
            </div>
            <CartPanel
              lines={lines}
              products={products}
              currency={currency}
              type={type}
              onTypeChange={setType}
              notes={notes}
              onNotesChange={setNotes}
              onClear={() => setLines([])}
              onRepeat={repeatLastOrder}
              repeatLoading={repeatLoading}
              onIncrement={(key) => updateQty(key, 1)}
              onDecrement={(key) => updateQty(key, -1)}
              onSetQuantity={setQty}
              onAddQuantity={(key, n) => updateQty(key, n)}
              onRemove={(key) => setLines((prev) => prev.filter((x) => x.key !== key))}
              onSubmit={submit}
              submitting={submitting}
              className="min-h-0 flex-1"
            />
          </div>
        </div>
      )}

      {/* ── Order-confirmed banner: the order reached the kitchen ─────── */}
      {lastConfirmed && (
        <div className="fixed inset-x-0 top-3 z-[var(--z-modal)] flex justify-center px-4">
          <div className="flex min-h-[52px] w-full max-w-md items-center justify-between gap-3 rounded-[var(--radius-lg)] bg-[var(--color-success)] px-4 py-2.5 text-white shadow-float">
            <div className="flex min-w-0 items-center gap-2.5">
              <span className="flex h-7 w-7 shrink-0 items-center justify-center rounded-full bg-white/20 text-sm font-bold">
                ✓
              </span>
              <div className="min-w-0">
                <p className="text-sm font-bold leading-tight">وصل الطلب للمطبخ</p>
                <p className="truncate text-[11.5px] leading-tight opacity-90" dir="ltr">
                  order-{lastConfirmed.orderNumber} · {formatMoney(lastConfirmed.totalAmount, currency)}
                </p>
              </div>
            </div>
            <button
              type="button"
              onClick={() => setLastConfirmed(null)}
              aria-label="إغلاق"
              className="flex h-11 w-11 shrink-0 items-center justify-center rounded-full transition-colors hover:bg-white/20"
            >
              <X className="h-4 w-4" />
            </button>
          </div>
        </div>
      )}

      {/* ── Addon picker ─────────────────────────────────────────────── */}
      {picker && (
        <div
          className="fixed inset-0 z-[var(--z-modal)] flex items-end justify-center bg-black/40 sm:items-center sm:p-4"
          role="dialog"
          aria-modal="true"
          aria-label={`خيارات — ${picker.name}`}
          onClick={(e) => { if (e.target === e.currentTarget) setPicker(null); }}
          onKeyDown={(e) => { if (e.key === 'Escape') setPicker(null); }}
        >
          <div
            ref={pickerRef}
            className="w-full max-w-md max-h-[85dvh] overflow-y-auto rounded-t-[12px] bg-[var(--color-surface)] p-4 pb-safe-bottom sm:max-h-[85vh] sm:rounded-[10px] animate-slide-up"
          >
            <div className="mb-3 flex items-center justify-between">
              <h3 className="text-sm font-bold">{picker.name}</h3>
              <button
                type="button"
                onClick={() => setPicker(null)}
                className="btn btn-ghost btn-sm"
                aria-label="إغلاق"
              >
                <X className="h-4 w-4" />
              </button>
            </div>
            <p className="mb-3 text-xs text-[var(--color-text-secondary)]">
              اختر الخيارات
            </p>
            <div className="mb-4 space-y-3">
              {pickerGroups.map((group) => {
                const choices = availableChoices(group);
                const bounds = effectiveBounds(group);
                const single = bounds.max === 1;
                return (
                  <div key={group.id} role={single ? 'radiogroup' : 'group'} aria-label={group.name}>
                    <p className="mb-1 text-[12px] font-bold text-[var(--color-text-secondary)]">
                      {group.name}
                      {bounds.min >= 1 && <span className="ms-1 text-[var(--color-primary)]">(إلزامي)</span>}
                    </p>
                    <ul className="space-y-1.5">
                      {choices.map((choice) => {
                        const on = selectedOptions.includes(choice.id);
                        return (
                          <li key={choice.id}>
                            <button
                              type="button"
                              role={single ? 'radio' : 'checkbox'}
                              aria-checked={on}
                              onClick={() => toggleOption(group, choice.id)}
                              className={`flex min-h-[44px] w-full items-center justify-between gap-2 rounded-[var(--radius-md)] border px-3 py-2 text-sm transition-colors ${
                                on
                                  ? 'border-[var(--color-primary)] bg-[var(--color-primary-tint)] font-semibold'
                                  : 'border-[var(--color-border)]'
                              }`}
                            >
                              <span className="flex items-center gap-2">
                                <span
                                  aria-hidden="true"
                                  className={`flex items-center justify-center border ${single ? 'rounded-full' : 'rounded-[4px]'} ${
                                    on ? 'border-[var(--color-primary)] bg-[var(--color-primary)] text-white' : 'border-[var(--color-border-strong)]'
                                  }`}
                                  style={{ height: '18px', width: '18px' }}
                                >
                                  {on && <Check className="h-3 w-3" />}
                                </span>
                                {choice.name}
                              </span>
                              <span className="shrink-0 text-xs text-[var(--color-text-secondary)]">
                                {Number(choice.price) > 0 ? `+${formatMoney(Number(choice.price), currency)}` : 'بدون زيادة'}
                              </span>
                            </button>
                          </li>
                        );
                      })}
                    </ul>
                  </div>
                );
              })}
            </div>
            <div className="flex gap-2">
              <Button block disabled={pickerViolation !== null} onClick={confirmOptions}>
                إضافة للسلة
              </Button>
              <Button variant="secondary" onClick={() => setPicker(null)}>
                إلغاء
              </Button>
            </div>
            {pickerViolation && (
              <p role="alert" className="mt-2 text-center text-[12.5px] font-semibold text-[var(--color-danger)]">
                {pickerViolation.message}
              </p>
            )}
          </div>
        </div>
      )}
    </div>
  );
}
