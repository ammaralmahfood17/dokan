'use client';

import { useCallback, useDeferredValue, useEffect, useMemo, useRef, useState, useSyncExternalStore } from 'react';
import { ShoppingBag, X, Check, Bell, FileText, Search, Languages } from 'lucide-react';
import { formatMoney, money, currencyDecimals } from '@/lib/utils';
import { isSoldOut, maxOrderableQty } from '@/lib/product-stock';
import {
  availableChoices,
  effectiveBounds,
  selectedChoices,
  validateOptionSelection,
} from '@/lib/product-options';
import { langOfText } from '@/lib/i18n';
import {
  addLine,
  buildPickedLine,
  buildQuickLine,
  cartItemCount,
  cartTotal,
  categoriesWithProducts,
  changeQuantity,
  filterMenuProducts,
  groupByCategory,
  lastProductLineKey,
  needsPicker,
  productQtyInCart,
  qtyByProduct,
  toggleOptionSelection,
  toggleQuickNoteText,
  uncategorizedProducts,
} from '@/lib/menu-cart';
import type { CartLine, Category, OrderItemOption, Product, ProductOptionChoice, ProductOptionGroup, ProductWithOptions, Project, Table } from '@/lib/types';
import { Button } from '@/components/ui/button';
import { toast } from 'sonner';
// D2: extracted sections — bottom sheet + product row now live in
// src/components/menu/ (menu-client stays the orchestrator).
import { Sheet } from '@/components/menu/sheet';
// FIX-C-003: الأسطح المستخرجة — cart + success state
// FIX-P-001: تحميل كسول للـ CartSheet (خارج الـ bundle الرئيسي — menu-client
// يبقى خفيفًا للعميل على اتصال ضعيف)
import dynamic from 'next/dynamic';
const CartSheet = dynamic(() => import('@/components/menu/cart-sheet').then((m) => m.CartSheet), {
  ssr: false,
});
import { OrderSuccessState } from '@/components/menu/order-success-state';
import { MenuHeader } from '@/components/menu/menu-header';
import { MenuCategoryPills } from '@/components/menu/menu-category-pills';
import { MenuProductArea } from '@/components/menu/menu-product-area';
import { MenuCartBar } from '@/components/menu/menu-cart-bar';
import { ProductPickerSheet } from '@/components/menu/product-picker-sheet';
import { MenuProductRow, type MenuProduct } from '@/components/menu/product-card';
// D7: offline indicator on the customer-facing menu (banner, not blocker).
import { OfflineBanner } from '@/components/ui/offline-banner';

// stable identity: useSyncExternalStore re-subscribes when this function changes
const subscribeNever = () => () => {};
import {
  queuePendingOrder,
  registerPendingOrderSync,
  removePendingOrder,
  type PendingOrderPayload,
} from '@/lib/pending-orders';
import {
  PENDING_ORDER_EVENT,
  type PendingOrderSyncMessage,
} from '@/lib/pwa-events';

/** Generic blur placeholder for product images — tiny 16×16 grey base64 */
const BLUR_PLACEHOLDER =
  'data:image/png;base64,iVBORw0KGgoAAAANSUhEUgAAABAAAAAQCAYAAAAf8/9hAAAAMklEQVQ4T2NkYPj/n4EBBJgYKAQMFFiAKcBAUwsDUx0DxS5gYKA8DCh2AQNlYUBZCgDxpwgRg9RXOAAAAABJRU5ErkJggg==';


/** UX-6: one-tap common item notes (drinks + food, Gulf phrasing). */
const QUICK_NOTE_CHIPS = ['بدون سكر', 'بدون ثلج', 'ثلج على جنب', 'حار زيادة'];

export function MenuClient({
  project,
  table,
  requireToken,
  categories,
  products,
}: {
  project: Project;
  table: Table;
  /** Table scan token from the QR URL (?k=…) — empty on a link that carries none. */
  /** D3: the page no longer receives the token - it is read from the URL on the client instead. */
  requireToken: boolean;
  /**
   * Server-computed (audit T2 #1): true while ordering is allowed — either the URL's token
   * resolved to this table, or the server is still in the rollout window
   * (REQUIRE_TABLE_TOKEN unset). The client never reads the flag itself, so the UI and the
   * server enforcement can never disagree.
   */

  categories: Category[];
  products: ProductWithOptions[];
}) {
  const [cart, setCart] = useState<CartLine[]>([]);
  const [cartOpen, setCartOpen] = useState(false);
  const [picker, setPicker] = useState<ProductWithOptions | null>(null);
  const [selectedOptions, setSelectedOptions] = useState<string[]>([]);
  const [itemNotes, setItemNotes] = useState('');
  const [orderNotes, setOrderNotes] = useState('');
  const [submitting, setSubmitting] = useState(false);
  // D10: persistent order error with a retry button (toast alone vanishes
  // and the customer is left guessing what happened).
  const [orderError, setOrderError] = useState<string | null>(null);
  const [orderDone, setOrderDone] = useState<{
    id: string;
    totalAmount: number;
    orderNumber: number;
  } | null>(null);
  const [activeCategory, setActiveCategory] = useState<string | 'all'>('all');
  const [busyAction, setBusyAction] = useState<'waiter' | 'bill' | null>(null);
  // UX-6: snapshot of the last placed cart — powers «كرر الطلب» on the
  // success screen (re-fill the same lines, customer just hits send again).
  const [lastCart, setLastCart] = useState<CartLine[] | null>(null);
  // Idempotency key for the checkout attempt in flight (migration 0014). Lives
  // in a ref, NOT state: it must survive re-renders without ever appearing in
  // the UI, and it must stay identical across the button retry AND the
  // offline-queue replay. Reset to null once the order is confirmed.
  const orderKeyRef = useRef<string | null>(null);
  const queuedCartRef = useRef<CartLine[] | null>(null);
  const [lastAddedKey, setLastAddedKey] = useState<string | null>(null);
  const lastAddedTimer = useRef<ReturnType<typeof setTimeout> | null>(null);
  // بحث في المنتجات (فقط للمنيو الكبير — 12+ منتج)
  const [menuQuery, setMenuQuery] = useState('');
  // تبديل لغة العرض: عربي / English (يستخدم name_en عندما متاح)
  // FIX-I-003: حفظ تفضيل اللغة في localStorage (لا يضيع عند refresh)
  const [lang, setLang] = useState<'ar' | 'en'>(() => {
    // UX-report C5: the WRITE below is try/caught but this READ was not —
    // Safari private mode / blocked storage throws on getItem and crashed
    // the whole public menu. Guard the read the same way.
    try {
      if (typeof window === 'undefined') return 'ar';
      return localStorage.getItem('dokan-lang') === 'en' ? 'en' : 'ar';
    } catch {
      return 'ar';
    }
  });
  useEffect(() => {
    try {
      localStorage.setItem('dokan-lang', lang);
    } catch {
      // privacy mode — تجاهل بصمت
    }
  }, [lang]);

  // D3: the table token travels in the URL the QR encodes (`?k=…`) and is read HERE, on the client,
  // so the server-rendered HTML is identical for every visitor and therefore cacheable. The token is
  // a UI gate only - `/api/public/order` resolves it through the SECURITY DEFINER function and is the
  // real boundary. `requireToken` is the rollout flag, constant for every visitor.
  // Read the browser URL without a setState-in-effect (this repo's react-hooks rule rejects that,
  // correctly: it costs a cascading render). useSyncExternalStore is the supported way to read a
  // client-only value with a distinct server snapshot.
  const tableToken = useSyncExternalStore(
    subscribeNever,
    () => {
      try {
        return new URLSearchParams(window.location.search).get('k') ?? '';
      } catch {
        return '';
      }
    },
    () => ''
  );
  const orderingEnabled = !requireToken || Boolean(tableToken);

  const displayName = useCallback(
    (p: ProductWithOptions) =>
      lang === 'en' && p.name_en ? p.name_en : p.name,
    [lang]
  );

  // Cleanup lastAddedTimer on unmount
  useEffect(() => {
    return () => {
      if (lastAddedTimer.current) clearTimeout(lastAddedTimer.current);
    };
  }, []);

  useEffect(() => {
    const handlePendingOrder = (event: Event) => {
      const message = (event as CustomEvent<PendingOrderSyncMessage>).detail;
      if (!message || message.id !== orderKeyRef.current) return;

      if (message.type === 'PENDING_ORDER_FAILED') {
        setOrderError(message.error);
        return;
      }
      if (!message.order) {
        setOrderError('تم إرسال الطلب، لكن تعذّر تحميل تفاصيل التأكيد');
        return;
      }

      if (queuedCartRef.current) setLastCart(queuedCartRef.current);
      orderKeyRef.current = null;
      queuedCartRef.current = null;
      setOrderError(null);
      setOrderDone({
        id: message.order.id,
        totalAmount: message.order.totalAmount,
        orderNumber: message.order.orderNumber,
      });
      setCart([]);
      setCartOpen(false);
      setOrderNotes('');
      setItemNotes('');
    };

    window.addEventListener(PENDING_ORDER_EVENT, handlePendingOrder);
    return () => window.removeEventListener(PENDING_ORDER_EVENT, handlePendingOrder);
  }, []);

  // Ref for smooth-scrolling to products section
  const productsRef = useRef<HTMLDivElement>(null);

  /** Language switch — the visible content changes language, so the document
   *  must say which one it is (audit T1 #8, WCAG 3.1.2). dir stays rtl. */
  const toggleLang = useCallback(() => {
    setLang((l) => {
      const next = l === 'ar' ? 'en' : 'ar';
      document.documentElement.lang = next;
      return next;
    });
  }, []);

  const currency = project.currency;

  // Perf: the quick-add / stepper handlers read the cart through a ref, so their
  // identity stays stable and React.memo on MenuProductRow can skip the cards
  // that did not change. A callback closing over `cart` would get a new identity
  // on every tap and re-render the entire grid.
  const cartRef = useRef(cart);
  useEffect(() => {
    cartRef.current = cart;
  }, [cart]);

  // Perf: defer the search filter so typing never blocks on a large menu.
  const deferredQuery = useDeferredValue(menuQuery);

  // The rule itself is `filterMenuProducts` in lib/menu-cart (pure, tested).
  const filtered = useMemo(
    () => filterMenuProducts(products, activeCategory, deferredQuery),
    [products, activeCategory, deferredQuery]
  );

  // البحث يظهر فقط للمنيو الكبير (12+ منتج) — لا يزحم المنيو الصغير
  const showMenuSearch = products.length >= 12;

  const total = useMemo(() => cartTotal(cart, currency), [cart, currency]);
  const itemCount = useMemo(() => cartItemCount(cart), [cart]);

  // Perf: O(1) quantity lookup per card. The old qtyOf(p.id) filtered the whole
  // cart once per product on every render — O(P×lines) per cart change.
  const cartQtyByProduct = useMemo(() => qtyByProduct(cart), [cart]);

  // Perf: group once per (filtered, categories) change instead of running
  // categories.some() + filtered.filter() inside the render map every render.
  const productsByCategory = useMemo(() => groupByCategory(filtered), [filtered]);

  const visibleCategories = useMemo(
    () => categoriesWithProducts(categories, productsByCategory),
    [categories, productsByCategory]
  );

  // Uncategorized products (category deleted → SET NULL): keep them visible.
  const uncategorized = useMemo(() => uncategorizedProducts(filtered), [filtered]);

  /** Scroll products into view when category changes (mobile smooth UX) */
  const handleCategoryChange = useCallback((catId: string | 'all') => {
    setActiveCategory(catId);
    // Small delay so React renders filtered items first
    setTimeout(() => {
      productsRef.current?.scrollIntoView({ behavior: 'smooth', block: 'start' });
    }, 50);
  }, []);

  const openProduct = useCallback((p: ProductWithOptions) => {
    setPicker(p);
    setSelectedOptions([]);
    setItemNotes('');
  }, []);

  /** UX-6: append/remove a quick-note phrase, keeping the 200-char cap. */
  function toggleQuickNote(note: string) {
    setItemNotes((prev) => toggleQuickNoteText(prev, note));
  }

  /** Single-choice groups replace; multi groups append up to their max. */
  function toggleOption(group: ProductOptionGroup, choiceId: string) {
    setSelectedOptions((prev) => toggleOptionSelection(prev, group, choiceId));
  }

  function confirmAdd() {
    if (!picker) return;
    const groups = picker.option_groups || [];
    // Validation + pricing + the line key live in lib/menu-cart (pure, tested):
    // a stale render can never add a half-configured line, and the quick-add path
    // and this one must agree on what "the same line" means.
    const built = buildPickedLine(picker, groups, selectedOptions, itemNotes, currency);
    if (!built.ok) {
      toast.error(built.message);
      return;
    }
    const { line } = built;
    const alreadyInCart = cart.some((l) => l.key === line.key);
    const wasEmpty = cart.length === 0;

    setCart((prev) => addLine(prev, line).lines);
    setPicker(null);

    // Auto-open the cart on the FIRST item so the customer can review + send.
    // Later adds only toast (don't interrupt multi-item ordering).
    if (wasEmpty) setCartOpen(true);

    // Visual feedback: flash badge on the product card + toast
    setLastAddedKey(picker.id);
    if (lastAddedTimer.current) clearTimeout(lastAddedTimer.current);
    lastAddedTimer.current = setTimeout(() => setLastAddedKey(null), 800);
    toast.success(alreadyInCart ? 'زادت الكمية' : 'أُضيف إلى السلة', { duration: 1200 });
  }

  // Quick-Add: add directly without addon picker.
  // Memoised and cart-ref-based: an identity that changed with the cart would
  // defeat MenuProductRow's memo and re-render every card on each tap.
  const quickAdd = useCallback((p: ProductWithOptions) => {
    const current = cartRef.current;
    // UX-6 guard: sold-out cards already block interaction, but the picker/
    // stepper paths must never queue an unavailable item (server would 400).
    // 0018: a tracked product with 0 portions left is sold out too.
    if (isSoldOut(p)) return;
    // Stock cap — never let the cart hold more portions than remain. The
    // server rejects the WHOLE order at checkout otherwise, so catching it on
    // the stepper is the difference between a nudge and a failed checkout.
    const inCart = productQtyInCart(current, p.id);
    if (inCart >= maxOrderableQty(p)) {
      toast.error('وصلت للكمية المتوفرة من هذا الصنف', { duration: 1600 });
      return;
    }
    // Any group with a pickable variety needs the picker — the customer has to
    // choose before the line can be priced.
    if (needsPicker(p)) {
      openProduct(p);
      return;
    }
    // The line (and its key) come from lib/menu-cart, so a quick-add and a
    // picker-add of the same product land on the SAME cart line.
    const line = buildQuickLine(p, currency);
    const alreadyInCart = current.some((l) => l.key === line.key);
    const wasEmpty = current.length === 0;
    setCart((prev) => addLine(prev, line).lines);
    // Auto-open the cart on the FIRST item (same UX as confirmAdd)
    if (wasEmpty) setCartOpen(true);
    // Visual feedback
    setLastAddedKey(p.id);
    if (lastAddedTimer.current) clearTimeout(lastAddedTimer.current);
    lastAddedTimer.current = setTimeout(() => setLastAddedKey(null), 800);
    toast.success(alreadyInCart ? 'زادت الكمية' : 'أُضيف إلى السلة', { duration: 1200 });
  }, [currency, openProduct]);

  const updateQty = useCallback((key: string, delta: number) => {
    setCart((prev) => changeQuantity(prev, key, delta));
  }, []);

  /** Decrement the most recently added cart line for this product. Declared here
   *  (a hook, so it must precede every early return) with a stable identity and
   *  the product as its argument, so the memoised card needs no per-card closure. */
  const decrementProduct = useCallback(
    (p: MenuProduct) => {
      const key = lastProductLineKey(cartRef.current, p.id);
      if (key) updateQty(key, -1);
    },
    [updateQty]
  );

  async function placeOrder() {
    if (!cart.length) return;
    setSubmitting(true);
    // One idempotency key per checkout attempt, minted on the FIRST attempt and
    // reused by every retry (button press, offline queue replay, background
    // sync). Holding it in a ref is what makes that possible: a fresh
    // crypto.randomUUID() per call would give each retry a new key and defeat
    // the whole point (migration 0014). It is cleared only once the order is
    // confirmed, so the next order gets a new key.
    if (!orderKeyRef.current) {
      orderKeyRef.current = crypto.randomUUID();
    }
    const idempotencyKey = orderKeyRef.current;
    try {
      const res = await fetch('/api/public/order', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          projectSlug: project.slug,
          tableSlug: table.slug,
          tableToken,
          clientRequestId: idempotencyKey,
          notes: orderNotes.trim() || undefined,
          items: cart.map((l) => ({
            productId: l.productId,
            quantity: l.quantity,
            optionIds: l.addons.map((a) => a.id),
            notes: l.notes || undefined,
          })),
        }),
      });
      const data = (await res.json()) as {
        error?: string;
        replayed?: boolean;
        order?: { id: string; status: string; totalAmount: number; orderNumber: number };
      };
      if (!res.ok || !data.order) {
        // D10: keep the error visible next to the confirm button so the
        // customer can retry — a toast disappears and leaves them stuck.
        setOrderError(data.error || 'فشل إرسال الطلب');
        return;
      }
      setOrderError(null);
      // UX-6: if the merchant changed a price while the customer was
      // collecting, the server total wins — say so instead of silently
      // charging a different amount than the cart showed.
      if (Math.abs(Number(data.order.totalAmount) - total) > 0.0005) {
        toast('تم تحديث سعر بعض الأصناف — المبلغ المعروض هو النهائي', { duration: 4000 });
      }
      setLastCart(cart);
      // Order is confirmed — release the key so the NEXT checkout mints a
      // fresh one. Until this point it must be preserved: a retry after a
      // lost response is the whole point.
      orderKeyRef.current = null;
      queuedCartRef.current = null;
      void removePendingOrder(idempotencyKey).catch(() => {});
      setOrderDone({
        id: data.order.id,
        totalAmount: data.order.totalAmount,
        orderNumber: data.order.orderNumber,
      });
      setCart([]);
      setCartOpen(false);
      setOrderNotes('');
      setItemNotes('');
    } catch {
      // FIX-W-002: حفظ الطلب في IndexedDB + تسجيل Background Sync —
      // عند عودة الاتصال يُرسل تلقائيًا (Chromium). Safari/Firefox:
      // زر إعادة المحاولة (D10) يغطيهم.
      try {
        const payload: PendingOrderPayload = {
          projectSlug: project.slug,
          tableSlug: table.slug,
          // The queued payload is replayed verbatim by the service worker, so the token
          // has to travel with it — otherwise the replay would be rejected on enforcement.
          tableToken,
          // SAME key as the attempt that just failed. The service worker
          // replays this payload verbatim, so the server recognises it as a
          // retry of one checkout and returns the original order if the
          // earlier attempt actually landed.
          clientRequestId: idempotencyKey,
          notes: orderNotes.trim() || undefined,
          items: cart.map((l) => ({
            productId: l.productId,
            quantity: l.quantity,
            optionIds: l.addons.map((a) => a.id),
            notes: l.notes || undefined,
          })),
        };
        queuedCartRef.current = [...cart];
        await queuePendingOrder(idempotencyKey, payload);
        const syncRegistered = await registerPendingOrderSync().catch(() => false);
        setOrderError(
          syncRegistered
            ? 'تعذّر الاتصال — حُفظ الطلب وسيُرسل تلقائيًا عند عودة الإنترنت'
            : 'تعذّر الاتصال — حُفظ الطلب، اضغط إعادة المحاولة عند عودة الإنترنت'
        );
      } catch {
        queuedCartRef.current = null;
        setOrderError('تعذّر الاتصال وحفظ الطلب — أعد المحاولة عند عودة الإنترنت');
      }
    } finally {
      setSubmitting(false);
    }
  }

  async function callService(kind: 'waiter' | 'bill') {
    setBusyAction(kind);
    try {
      const res = await fetch(`/api/public/${kind}`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          projectSlug: project.slug,
          tableSlug: table.slug,
          tableToken,
        }),
      });
      if (!res.ok) {
        // Surface the server's reason (rate limited / stale QR / unknown table)
        // instead of a generic failure — the customer needs to know whether to
        // wait or to rescan, and a bare «تعذّر إرسال الطلب» tells them neither.
        const data = (await res.json().catch(() => null)) as { error?: string } | null;
        toast.error(data?.error || 'تعذّر إرسال الطلب');
        return;
      }
      toast.success(kind === 'waiter' ? 'تم استدعاء الموظف' : 'تم طلب الفاتورة');
    } catch {
      toast.error('تعذّر الاتصال');
    } finally {
      setBusyAction(null);
    }
  }

  // ======== ORDER DONE SCREEN (FIX-C-003: extracted component) ========
  if (orderDone) {
    return (
      <OrderSuccessState
        orderNumber={orderDone.orderNumber}
        orderId={orderDone.id}
        projectSlug={project.slug}
        totalAmount={orderDone.totalAmount}
        currency={currency}
        busyAction={busyAction}
        onCallService={callService}
        onOrderMore={() => setOrderDone(null)}
        canReorder={!!lastCart?.length}
        onReorder={() => {
          if (lastCart?.length) {
            setCart(lastCart);
            setOrderDone(null);
            setCartOpen(true);
          }
        }}
      />
    );
  }

  // ======== CART BAR BADGE ========
  const cartBadge = itemCount > 0;

  // ---- Product picker: option groups, live total, and the one reason the
  // "add" button is still disabled. All derived from the SAME rules module the
  // server prices with, so the UI can never accept something the API rejects.
  const pickerGroups = picker
    ? (picker.option_groups || []).filter((g) => availableChoices(g).length > 0)
    : [];
  const pickerViolation = picker
    ? validateOptionSelection(picker.option_groups || [], selectedOptions)
    : null;
  const pickerTotal = picker
    ? money(
        Number(picker.price) +
          selectedChoices(picker.option_groups || [], selectedOptions).reduce(
            (sum, c) => sum + Number(c.price),
            0
          ),
        currencyDecimals(currency)
      )
    : 0;

  /** Render a single product card — mockup: bordered grid card + stepper. */
  function renderProduct(p: ProductWithOptions, isFirst = false) {
    return (
      <MenuProductRow
        key={p.id}
        product={p}
        currency={currency}
        isFirst={isFirst}
        lastAdded={lastAddedKey === p.id}
        quantity={cartQtyByProduct.get(p.id) ?? 0}
        displayName={displayName(p)}
        onQuickAdd={quickAdd}
        onDecrement={decrementProduct}
      />
    );
  }

  // ======== MAIN MENU ========
  return (
    <div className="min-h-dvh bg-[var(--color-bg)] pb-24 page-enter">
      {/* D7: offline notice — replaces the full-screen blocker (design: the
          customer should still be able to browse the cached menu) */}
      <OfflineBanner />
      <MenuHeader
        projectName={project.name}
        tableNumber={table.number}
        lang={lang}
        busyAction={busyAction}
        onCallService={callService}
      />

      {/* CATEGORIES — extracted component (wave 4 phase b) */}
      {categories.length > 0 && (
        <MenuCategoryPills
          categories={categories}
          activeCategory={activeCategory}
          onSelect={handleCategoryChange}
        />
      )}

      <MenuProductArea
        mainRef={productsRef}
        showSearch={showMenuSearch}
        query={menuQuery}
        onQueryChange={setMenuQuery}
        lang={lang}
        showLangToggle={products.some((p) => p.name_en)}
        onToggleLang={toggleLang}
        filtered={filtered}
        activeCategory={activeCategory}
        visibleCategories={visibleCategories}
        productsByCategory={productsByCategory}
        uncategorized={uncategorized}
        categories={categories}
        renderProduct={renderProduct}
      />

      {/* CART FLOATING BAR — extracted component (wave 4 phase b) */}
      {cartBadge && (
        <MenuCartBar
          itemCount={itemCount}
          total={total}
          currency={currency}
          orderingEnabled={orderingEnabled}
          onOpen={() => setCartOpen(true)}
        />
      )}

      {/* PRODUCT PICKER SHEET — extracted component (wave 4 phase b) */}
      {picker && (
        <ProductPickerSheet
          picker={picker}
          groups={pickerGroups}
          selectedOptionIds={selectedOptions}
          total={pickerTotal}
          currency={currency}
          notes={itemNotes}
          onNotesChange={setItemNotes}
          onToggleQuickNote={toggleQuickNote}
          onToggleOption={toggleOption}
          violation={pickerViolation}
          onConfirm={confirmAdd}
          onClose={() => setPicker(null)}
        />
      )}

      {/* CART SHEET — FIX-C-003: extracted component */}
      {cartOpen && (
        <CartSheet
          open={cartOpen}
          orderingEnabled={orderingEnabled}
          lines={cart}
          currency={currency}
          orderNotes={orderNotes}
          onOrderNotesChange={(v) => setOrderNotes(v)}
          onQty={updateQty}
          submitting={submitting}
          orderError={orderError}
          onRetry={() => {
            setOrderError(null);
            placeOrder();
          }}
          onPlaceOrder={placeOrder}
          onClose={() => setCartOpen(false)}
        />
      )}
    </div>
  );
}
