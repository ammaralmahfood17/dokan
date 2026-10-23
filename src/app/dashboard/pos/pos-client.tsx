'use client';

import { useCallback, useEffect, useMemo, useRef, useState, type ComponentProps } from 'react';
import dynamic from 'next/dynamic';

// Opened only when a product needs options — not part of the POS first paint.
const PosAddonPicker = dynamic(
  () => import('@/components/pos/pos-addon-picker').then((m) => m.PosAddonPicker),
  { ssr: false }
);
import { lockBodyScroll } from '@/lib/use-body-scroll-lock';
import { Check, Search, ShoppingBag, WifiOff, X } from 'lucide-react';
import { createClient } from '@/lib/supabase/client';
import { formatMoney, money, currencyDecimals } from '@/lib/utils';
import type { OrderType, Product, ProductOptionGroup, ProductWithOptions, TableBoardRow } from '@/lib/types';
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

import { ProductCard } from '@/components/pos/product-card';
import type { PosLine } from '@/components/pos/types';
import { toast } from 'sonner';
import { isSoldOut } from '@/lib/product-stock';
import { postPosOrder } from '@/lib/pos-submit';
import {
  enqueuePosOrder,
  listPosQueue,
  pendingPosCount,
  removePosOrder,
  type PosQueuePayload,
} from '@/lib/pos-offline-queue';
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
  tables = [],
  initialBoard = [],
}: {
  projectId: string;
  currency: string;
  products: ProductWithOptions[];
  /** UX-U12: تكرار طلبات آخر 7 أيام لكل منتج — لتصدر الأكثر طلبًا */
  productFrequency?: Record<string, number>;
  /** Menu categories for the cashier filter (UX-17). */
  categories?: { id: string; name: string }[];
  /** Active tables for a dine-in sale. */
  tables?: { id: string; number: number; slug: string }[];
  /** table_board(): which tables are busy and for how much. */
  initialBoard?: TableBoardRow[];
}) {
  const [type, setType] = useState<OrderType>('walkin');
  const [tableId, setTableId] = useState<string | null>(null);
  const [board, setBoard] = useState<TableBoardRow[]>(initialBoard);

  const boardByTable = useMemo(() => new Map(board.map((r) => [r.table_id, r])), [board]);

  const loadBoard = useCallback(async () => {
    const supabase = createClient();
    const { data } = await supabase.rpc('table_board', { p_project_id: projectId });
    if (data) setBoard(data as TableBoardRow[]);
  }, [projectId]);
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

  // ---------- Offline queue (Wave 3) ----------
  // A sale must not be lost when the link drops. The queue stores product ids
  // only (the server prices it), and every item carries the clientRequestId it
  // was first sent with, so the flush can never create a second order.
  const [pending, setPending] = useState(0);
  const flushing = useRef(false);

  const refreshPending = useCallback(async () => {
    try {
      setPending(await pendingPosCount());
    } catch {
      // IndexedDB unavailable (private mode / old webview): the POS still works
      // online; it just cannot promise durability. Never block the sale for it.
    }
  }, []);

  const flushQueue = useCallback(async () => {
    if (flushing.current) return;
    flushing.current = true;
    try {
      const items = await listPosQueue();
      for (const item of items) {
        const result = await postPosOrder({ ...item.payload, clientRequestId: item.id });
        if (result.ok) {
          await removePosOrder(item.id);
          toast.success(
            `تم إرسال طلب محفوظ order-${result.order.orderNumber} — ${formatMoney(result.order.totalAmount, currency)}`
          );
          continue;
        }
        if (result.outcome === 'retry') {
          // Network still down / server busy: keep this one AND everything
          // after it, in order. Retrying out of order would renumber the day.
          break;
        }
        // The server will never accept this payload (sold out, deleted table,
        // forbidden). Retrying forever would be a lie; surface it and drop it.
        await removePosOrder(item.id);
        toast.error(`طلب محفوظ لم يُقبل: ${result.error}`);
      }
    } finally {
      flushing.current = false;
      await refreshPending();
    }
  }, [currency, refreshPending]);

  useEffect(() => {
    // Deferred one tick: the first read must not setState inside the effect body
    // (React's cascading-render rule), and a queue read is not urgent.
    const boot = window.setTimeout(() => {
      void refreshPending();
      void flushQueue();
    }, 0);
    const onOnline = () => void flushQueue();
    window.addEventListener('online', onOnline);
    return () => {
      window.clearTimeout(boot);
      window.removeEventListener('online', onOnline);
    };
  }, [flushQueue, refreshPending]);

  // While anything is queued, poll slowly so a flaky link that never fires an
  // `online` event still drains (mobile browsers do both).
  useEffect(() => {
    if (pending <= 0) return;
    const timer = window.setInterval(() => void flushQueue(), 30_000);
    return () => window.clearInterval(timer);
  }, [pending, flushQueue]);

  async function submit() {
    if (!lines.length) {
      toast.error('السلة فارغة');
      return;
    }
    setSubmitting(true);
    // One id per sale ATTEMPT: a retry reuses it (idempotent), a new sale gets
    // a new one. Generated before the request so a lost response is still
    // recoverable from the queue.
    const clientRequestId =
      typeof crypto !== 'undefined' && 'randomUUID' in crypto
        ? crypto.randomUUID()
        : `${Date.now()}-${Math.random().toString(16).slice(2)}`;
    const payload: PosQueuePayload = {
      projectId,
      type,
      tableId: type === 'dinein' ? tableId : null,
      notes: notes.trim() || undefined,
      items: lines.map((l) => ({
        productId: l.productId,
        quantity: l.quantity,
        optionIds: l.optionIds,
      })),
    };

    try {
      if (typeof navigator !== 'undefined' && !navigator.onLine) {
        await enqueuePosOrder({ id: clientRequestId, payload, createdAt: Date.now(), attempts: 1 });
        await refreshPending();
        toast.success('لا يوجد اتصال — حُفظ الطلب وسيُرسل تلقائيًا');
        setLines([]);
        setNotes('');
        setCartOpen(false);
        return;
      }

      const result = await postPosOrder({ ...payload, clientRequestId });
      if (!result.ok) {
        if (result.outcome === 'retry') {
          // The request may have reached the server (timeout) — the SAME id
          // makes the replay safe either way.
          await enqueuePosOrder({ id: clientRequestId, payload, createdAt: Date.now(), attempts: 1 });
          await refreshPending();
          toast.success('تعذّر إكمال الطلب — حُفظ وسيُرسل تلقائيًا');
          setLines([]);
          setNotes('');
          setCartOpen(false);
          return;
        }
        console.error('[POS] Order creation failed', { error: result.error, type, itemCount: lines.length });
        toast.error(result.error);
        return;
      }

      toast.success(
        `تم الطلب order-${result.order.orderNumber} — ${formatMoney(result.order.totalAmount, currency)}`
      );
      setLines([]);
      setNotes('');
      setCartOpen(false);
      // Confirmation state — shows "الطلب وصل المطبخ" banner + allows
      // repeat-last-order to restore the exact same cart in one tap.
      setLastConfirmed({ orderNumber: result.order.orderNumber, totalAmount: result.order.totalAmount });
      // The table just became busy (or its total grew): refresh the picker so
      // the next sale sees the truth instead of the page-load snapshot.
      void loadBoard();
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
    <div className="page page-wide page-pos">
      <div className="page-header">
        <div>
          <h1>نقطة البيع</h1>
        </div>
      </div>

      {/* Dine-in needs a TABLE, and the cashier has to see whether that table
          already has customers and a running total — otherwise two waiters open
          two parallel bills at one table. The picker is only shown for «طاولة»
          because a walk-in sale must not be attached to a table by accident. */}
      {type === 'dinein' && (
        <section className="mb-3" aria-label="اختيار الطاولة">
          <div className="mb-1.5 flex flex-wrap items-center gap-2">
            <p className="section-title mb-0">الطاولة</p>
            {tableId && boardByTable.get(tableId)?.session_id ? (
              <span className="text-caption font-semibold text-[var(--color-primary)]">
                مفتوحة — الإجمالي {formatMoney(boardByTable.get(tableId)!.total_amount, currency)}
              </span>
            ) : tableId ? (
              <span className="text-caption text-[var(--color-text-secondary)]">متاحة — بتفتح جلسة جديدة</span>
            ) : (
              <span className="text-caption text-[var(--color-text-secondary)]">
                اختر طاولة، أو اتركها فارغة لطلب بدون طاولة
              </span>
            )}
          </div>
          <div className="flex flex-wrap gap-1.5">
            {tables.map((t) => {
              const row = boardByTable.get(t.id);
              const busy = Boolean(row?.session_id);
              const selected = tableId === t.id;
              return (
                <button
                  key={t.id}
                  type="button"
                  aria-pressed={selected}
                  onClick={() => setTableId(selected ? null : t.id)}
                  className={`flex min-h-11 items-center gap-1.5 rounded-[var(--radius-md)] border px-3 text-label font-bold ${
                    selected
                      ? 'border-[var(--color-primary)] bg-[var(--color-primary)] text-white'
                      : busy
                        ? 'border-[var(--color-primary)] bg-[var(--color-primary-tint)] text-[var(--color-primary)]'
                        : 'border-[var(--color-border-strong)] bg-[var(--color-surface)] text-[var(--color-text)]'
                  }`}
                >
                  <span dir="ltr">{String(t.number).padStart(2, '0')}</span>
                  {busy && row ? (
                    <span className="text-caption font-semibold" dir="ltr">
                      {formatMoney(row.total_amount, currency)}
                    </span>
                  ) : null}
                </button>
              );
            })}
          </div>
        </section>
      )}

      {/* Queued sales are visible at every width — a sale the cashier thinks is
          sent but is sitting on the device is the worst possible state. */}
      {pending > 0 && (
        <div
          role="status"
          aria-live="polite"
          className="mb-3 flex flex-wrap items-center gap-2 rounded-[var(--radius-md)] border border-[color-mix(in_srgb,var(--color-warn)_35%,transparent)] bg-[var(--color-warn-tint)] px-3 py-2 text-[13px] font-semibold text-[var(--color-warn)]"
        >
          <WifiOff className="h-4 w-4 shrink-0" aria-hidden="true" />
          <span>
            {pending === 1 ? 'طلب محفوظ بانتظار الاتصال' : `${pending} طلبات محفوظة بانتظار الاتصال`}
          </span>
          <button
            type="button"
            onClick={() => void flushQueue()}
            className="ms-auto min-h-11 rounded-[8px] border border-current px-3 text-[13px] font-bold"
          >
            إرسال الآن
          </button>
        </div>
      )}

      <div data-pos-shell className="xl:grid xl:grid-cols-[minmax(0,1fr)_360px] xl:items-start xl:gap-4">
        {/* ── Left: product grid (extracted component, wave 4 phase b) ── */}
        <PosProductGrid
          type={type}
          onTypeChange={(t) => {
            setType(t);
            // Leaving «طاولة» must drop the selection: a stale id would attach a
            // takeaway sale to somebody's open bill.
            if (t !== 'dinein') setTableId(null);
          }}
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

        {/* ── Right: cart panel (desktop ≥1024 only) ───────────────────
            Below 1280 the cart is the summary bar + bottom sheet: at 1024 a
            360px docked column leaves ~390px for the grid — two tiles, when the
            cashier needs four. The tile grid wins until there is real room. */}
        <aside data-pos-cart className="hidden xl:block">
          <div className="xl:sticky xl:top-0 xl:h-dvh">
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
