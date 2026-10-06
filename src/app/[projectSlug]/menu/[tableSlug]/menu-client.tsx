'use client';

import { useCallback, useEffect, useMemo, useRef, useState , useSyncExternalStore } from 'react';
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
import type {
  CartLine,
  Category,
  OrderItemOption,
  Product,
  ProductOptionChoice,
  ProductOptionGroup,
  Project,
  Table,
} from '@/lib/types';
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
import { MenuProductRow } from '@/components/menu/product-card';
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

type ProductWithOptions = Product & { option_groups: ProductOptionGroup[] };

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

  const currency = project.currency;

  const filtered = useMemo(() => {
    let list = products;
    if (activeCategory !== 'all') {
      list = list.filter((p) => p.category_id === activeCategory);
    }
    const q = menuQuery.trim().toLowerCase();
    if (q) {
      list = list.filter(
        (p) =>
          p.name.toLowerCase().includes(q) ||
          (p.name_en ?? '').toLowerCase().includes(q)
      );
    }
    return list;
  }, [products, activeCategory, menuQuery]);

  // البحث يظهر فقط للمنيو الكبير (12+ منتج) — لا يزحم المنيو الصغير
  const showMenuSearch = products.length >= 12;

  const total = useMemo(
    () => money(cart.reduce((s, l) => s + l.unitPrice * l.quantity, 0), currencyDecimals(currency)),
    [cart, currency]
  );
  const itemCount = useMemo(
    () => cart.reduce((s, l) => s + l.quantity, 0),
    [cart]
  );

  /** Scroll products into view when category changes (mobile smooth UX) */
  const handleCategoryChange = useCallback((catId: string | 'all') => {
    setActiveCategory(catId);
    // Small delay so React renders filtered items first
    setTimeout(() => {
      productsRef.current?.scrollIntoView({ behavior: 'smooth', block: 'start' });
    }, 50);
  }, []);

  function openProduct(p: ProductWithOptions) {
    setPicker(p);
    setSelectedOptions([]);
    setItemNotes('');
  }

  /** UX-6: append/remove a quick-note phrase, keeping the 200-char cap. */
  function toggleQuickNote(note: string) {
    setItemNotes((prev) => {
      if (prev.includes(note)) {
        return prev
          .replace(note, '')
          .replace(/،،+/g, '،')
          .replace(/^[،\s]+/, '')
          .replace(/[،\s]+$/, '');
      }
      const next = prev.trim() ? `${prev}، ${note}` : note;
      return next.length <= 200 ? next : prev;
    });
  }

  /** Single-choice groups replace; multi groups append up to their max. */
  function toggleOption(group: ProductOptionGroup, choiceId: string) {
    const bounds = effectiveBounds(group);
    const groupIds = new Set(availableChoices(group).map((c) => c.id));
    setSelectedOptions((prev) => {
      if (prev.includes(choiceId)) return prev.filter((id) => id !== choiceId);
      if (bounds.max === 1) {
        return [...prev.filter((id) => !groupIds.has(id)), choiceId];
      }
      const picked = availableChoices(group).filter((c) => prev.includes(c.id)).length;
      if (picked >= bounds.max) return prev; // at the group's max — ignore the tap
      return [...prev, choiceId];
    });
  }

  function confirmAdd() {
    if (!picker) return;
    const groups = picker.option_groups || [];
    // The picker disables the button while this fails, but the check runs again
    // here so a stale render can never add a half-configured line.
    const violation = validateOptionSelection(groups, selectedOptions);
    if (violation) {
      toast.error(violation.message);
      return;
    }
    const options: OrderItemOption[] = selectedChoices(groups, selectedOptions).map((c) => ({
      id: c.id,
      name: c.name,
      price: money(Number(c.price), currencyDecimals(currency)),
    }));
    const optionTotal = money(options.reduce((s, o) => s + o.price, 0), currencyDecimals(currency));
    const unitPrice = money(Number(picker.price) + optionTotal, currencyDecimals(currency));
    const key = `${picker.id}:${options
      .map((o) => o.id)
      .sort()
      .join(',')}:${itemNotes.trim()}`;

    const alreadyInCart = cart.some((l) => l.key === key);
    const wasEmpty = cart.length === 0;

    setCart((prev) => {
      const existing = prev.find((l) => l.key === key);
      if (existing) {
        return prev.map((l) =>
          l.key === key ? { ...l, quantity: l.quantity + 1 } : l
        );
      }
      return [
        ...prev,
        {
          key,
          productId: picker.id,
          productName: picker.name,
          unitPrice,
          quantity: 1,
          addons: options,
          notes: itemNotes.trim(),
        },
      ];
    });
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

  // Quick-Add: add directly without addon picker
  function quickAdd(p: ProductWithOptions) {
    // UX-6 guard: sold-out cards already block interaction, but the picker/
    // stepper paths must never queue an unavailable item (server would 400).
    // 0018: a tracked product with 0 portions left is sold out too.
    if (isSoldOut(p)) return;
    // Stock cap — never let the cart hold more portions than remain. The
    // server rejects the WHOLE order at checkout otherwise, so catching it on
    // the stepper is the difference between a nudge and a failed checkout.
    if (qtyOf(p.id) >= maxOrderableQty(p)) {
      toast.error('وصلت للكمية المتوفرة من هذا الصنف', { duration: 1600 });
      return;
    }
    // Any group with a pickable variety needs the picker — the customer has to
    // choose before the line can be priced.
    if ((p.option_groups || []).some((g) => availableChoices(g).length > 0)) {
      openProduct(p);
      return;
    }
    const key = `${p.id}::`;
    const alreadyInCart = cart.some((l) => l.key === key);
    const wasEmpty = cart.length === 0;
    setCart((prev) => {
      const existing = prev.find((l) => l.key === key);
      if (existing) {
        return prev.map((l) =>
          l.key === key ? { ...l, quantity: l.quantity + 1 } : l
        );
      }
      return [
        ...prev,
        {
          key,
          productId: p.id,
          productName: p.name,
          unitPrice: money(Number(p.price), currencyDecimals(currency)),
          quantity: 1,
          addons: [],
          notes: '',
        },
      ];
    });
    // Auto-open the cart on the FIRST item (same UX as confirmAdd)
    if (wasEmpty) setCartOpen(true);
    // Visual feedback
    setLastAddedKey(p.id);
    if (lastAddedTimer.current) clearTimeout(lastAddedTimer.current);
    lastAddedTimer.current = setTimeout(() => setLastAddedKey(null), 800);
    toast.success(alreadyInCart ? 'زادت الكمية' : 'أُضيف إلى السلة', { duration: 1200 });
  }

  function updateQty(key: string, delta: number) {
    setCart((prev) =>
      prev
        .map((l) =>
          l.key === key ? { ...l, quantity: l.quantity + delta } : l
        )
        .filter((l) => l.quantity > 0)
    );
  }

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

  /** Total qty of this product across all cart lines (addon keys merged). */
  function qtyOf(productId: string) {
    return cart.filter((l) => l.productId === productId).reduce((s, l) => s + l.quantity, 0);
  }

  /** Decrement the most recently added cart line for this product. */
  function decrementProduct(productId: string) {
    const line = [...cart].reverse().find((l) => l.productId === productId);
    if (line) updateQty(line.key, -1);
  }

  /** Render a single product card — mockup: bordered grid card + stepper. */
  function renderProduct(p: ProductWithOptions, isFirst = false) {
    return (
      <MenuProductRow
        key={p.id}
        product={p}
        currency={currency}
        isFirst={isFirst}
        lastAdded={lastAddedKey === p.id}
        quantity={qtyOf(p.id)}
        displayName={displayName(p)}
        onQuickAdd={quickAdd}
        onDecrement={() => decrementProduct(p.id)}
      />
    );
  }

  // ======== MAIN MENU ========
  return (
    <div className="min-h-dvh bg-[var(--color-bg)] pb-24 page-enter">
      {/* D7: offline notice — replaces the full-screen blocker (design: the
          customer should still be able to browse the cached menu) */}
      <OfflineBanner />
      {/* HEADER — brand mark + TABLE chip */}
      <header
        className="sticky top-0 z-[var(--z-sticky)] border-b border-[var(--color-border)] px-4 py-3.5 backdrop-blur-md"
        style={{ background: 'color-mix(in srgb, var(--color-bg) 92%, transparent)' }}
      >
        <div className="mx-auto flex max-w-[480px] items-center justify-between gap-3">
          <div className="flex min-w-0 items-center gap-2.5">
            <div
              className="flex h-10 w-10 shrink-0 items-center justify-center rounded-[10px] bg-[var(--color-text)] font-display text-[18px] font-bold text-[var(--color-bg)]"
            >
              {project.name.slice(0, 1)}
            </div>
            <div className="min-w-0">
              <h1 lang={langOfText(project.name)} className="truncate font-display text-[17px] font-bold">
                {project.name}
              </h1>
              <p className="text-[11.5px] text-[var(--color-text-secondary)]">
                امسح واطلب من طاولتك
              </p>
            </div>
          </div>
          {/* Table chip */}
          <div className="flex items-center gap-1.5">
            <div className="rounded-full border border-[var(--color-border-strong)] px-3 py-1 font-mono text-[12px] font-semibold tabular-nums text-[var(--color-text-secondary)]">
              {lang === 'en' ? 'Table' : 'طاولة'} <span dir="ltr">{String(table.number).padStart(2, '0')}</span>
            </div>
            <button
              type="button"
              disabled={busyAction !== null}
              onClick={() => callService('waiter')}
              className="min-h-[44px] rounded-[var(--radius-md)] border border-[var(--color-border)] bg-[var(--color-surface)] px-3 text-xs font-bold transition-colors hover:bg-[var(--color-bg)] disabled:opacity-50"
            >
              موظف
            </button>
            <button
              type="button"
              disabled={busyAction !== null}
              onClick={() => callService('bill')}
              className="min-h-[44px] rounded-[var(--radius-md)] border border-[var(--color-border)] bg-[var(--color-surface)] px-3 text-xs font-bold transition-colors hover:bg-[var(--color-bg)] disabled:opacity-50"
            >
              فاتورة
            </button>
          </div>
        </div>
      </header>

      {/* CATEGORIES — pills, active = primary (mockup) */}
      {categories.length > 0 && (
        <div className="sticky top-[57px] z-[var(--z-sticky)] border-b border-[var(--color-border)] bg-[var(--color-bg)]">
          {/* FIX-R-003: fade على الحواف يشير لوجود محتوى إضافي (scrollbar مخفي) */}
          <div
            className="mx-auto flex max-w-[480px] gap-2 overflow-x-auto px-3 pb-1 pt-1"
            style={{
              scrollbarWidth: 'none',
              maskImage: 'linear-gradient(to left, transparent, black 24px)',
              WebkitMaskImage: 'linear-gradient(to left, transparent, black 24px)',
            }}
          >
            <button
              type="button"
              onClick={() => handleCategoryChange('all')}
              className={`min-h-[44px] shrink-0 whitespace-nowrap rounded-full px-4 text-[13px] font-semibold transition-colors ${
                activeCategory === 'all'
                  ? 'bg-[var(--color-primary)] text-white'
                  : 'border border-[var(--color-border-strong)] bg-[var(--color-surface)] text-[var(--color-text-secondary)] hover:border-[var(--color-text-tertiary)] hover:text-[var(--color-text)]'
              }`}
            >
              الكل
            </button>
            {categories.map((c) => (
              <button
                key={c.id}
                type="button"
                onClick={() => handleCategoryChange(c.id)}
                className={`min-h-[44px] shrink-0 whitespace-nowrap rounded-full px-4 text-[13px] font-semibold transition-colors ${
                  activeCategory === c.id
                    ? 'bg-[var(--color-primary)] text-white'
                    : 'border border-[var(--color-border-strong)] bg-[var(--color-surface)] text-[var(--color-text-secondary)] hover:border-[var(--color-text-tertiary)] hover:text-[var(--color-text)]'
                }`}
              >
                {c.name}
              </button>
            ))}
          </div>
        </div>
      )}

      {/* PRODUCTS — grouped by category */}
      <main ref={productsRef} className="mx-auto max-w-lg px-3 py-4">
        {/* Search + language toggle — search only for big menus */}
        <div className="mb-4 flex items-center gap-2">
          {showMenuSearch && (
            <div className="relative min-w-0 flex-1">
              <Search className="pointer-events-none absolute start-3 top-1/2 h-4 w-4 -translate-y-1/2 text-[var(--color-text-muted)]" />
              <input
                type="search"
                inputMode="search"
                value={menuQuery}
                onChange={(e) => setMenuQuery(e.target.value)}
                placeholder="ابحث عن منتج…"
                aria-label="ابحث في القائمة"
                maxLength={60}
                className="input min-h-[44px] w-full ps-10! pe-10!"
                style={{ borderRadius: 'var(--radius-md)' }}
              />
              {menuQuery && (
                <button
                  type="button"
                  onClick={() => setMenuQuery('')}
                  aria-label="مسح البحث"
                  className="absolute end-0 top-1/2 flex h-11 w-11 -translate-y-1/2 items-center justify-center rounded-full text-[var(--color-text-muted)] hover:bg-[var(--color-surface-sunken)]"
                >
                  <X className="h-4 w-4" />
                </button>
              )}
            </div>
          )}
          {products.some((p) => p.name_en) && (
            <button
              type="button"
              // audit T1 #8 (WCAG 3.1.2): the visible content switches language, so the document
              // has to say which one it is. dir stays rtl - the layout is RTL-first by design.
              onClick={() =>
                setLang((l) => {
                  const next = l === 'ar' ? 'en' : 'ar';
                  document.documentElement.lang = next;
                  return next;
                })
              }
              aria-label={lang === 'ar' ? 'التبديل إلى الإنجليزية' : 'Switch to Arabic'}
              aria-pressed={lang === 'en'}
              className="flex h-[44px] shrink-0 items-center gap-1.5 rounded-[var(--radius-md)] border border-[var(--color-border)] bg-[var(--color-surface)] px-3 text-xs font-bold text-[var(--color-text-secondary)] transition-colors hover:border-[var(--color-primary)]"
            >
              <Languages className="h-4 w-4" />
              {lang === 'ar' ? 'EN' : 'عربي'}
            </button>
          )}
        </div>
        {!filtered.length ? (
          menuQuery.trim() ? (
            /* v1.1 Calm Surface mockup — signature empty search state */
            <div className="flex flex-col items-center gap-2.5 px-8 py-14 text-center">
              <div className="mb-1 flex h-[52px] w-[52px] items-center justify-center rounded-full bg-[var(--color-primary-tint)] text-[var(--color-primary)]">
                <Search className="h-[22px] w-[22px]" />
              </div>
              <p className="text-[15px] font-bold">ما حصلنا شي يطابق بحثك</p>
              <p className="max-w-[240px] text-[13px] text-[var(--color-text-secondary)]">
                جرّب كلمة ثانية، أو تصفّح الأقسام من الأعلى
              </p>
              <button
                type="button"
                onClick={() => setMenuQuery('')}
                className="mt-1.5 rounded-[var(--radius-md)] px-3 py-2 text-[13px] font-bold text-[var(--color-primary)] transition-colors hover:bg-[var(--color-primary-tint)]"
              >
                مسح البحث
              </button>
            </div>
          ) : (
            <div className="card empty">
              <h3>القائمة فارغة</h3>
              <p className="text-sm">لا توجد منتجات متاحة حالياً.</p>
            </div>
          )
        ) : (
          <>
            {activeCategory === 'all' ? (
              /* All categories: group products under each category */
              <>
                {categories.filter((c) => products.some((p) => p.category_id === c.id)).map((cat, catIdx) => {
                  const catProducts = filtered.filter((p) => p.category_id === cat.id);
                  if (!catProducts.length) return null;
                  return (
                    <section key={cat.id} className="mb-6">
                      <div className="mb-3">
                        <h2 className="font-display text-[15.5px] font-bold">{cat.name}</h2>
                        <p className="mt-0.5 text-[12.5px] text-[var(--color-text-tertiary)]">
                          {catProducts.length} {catProducts.length === 1 ? 'صنف' : 'أصناف'}
                        </p>
                      </div>
                      <div className="grid grid-cols-2 gap-3 min-[480px]:grid-cols-3">
                        {catProducts.map((p, idx) => renderProduct(p, idx === 0 && catIdx === 0))}
                      </div>
                    </section>
                  );
                })}
                {/* Uncategorized products (category deleted → SET NULL): keep them visible */}
                {products.some((p) => !p.category_id) && (
                  <section className="mb-6">
                    <div className="mb-3">
                      <h2 className="font-display text-[15.5px] font-bold">بدون تصنيف</h2>
                      <p className="mt-0.5 text-[12.5px] text-[var(--color-text-tertiary)]">
                        {products.filter((p) => !p.category_id).length}{' '}
                        {products.filter((p) => !p.category_id).length === 1 ? 'صنف' : 'أصناف'}
                      </p>
                    </div>
                    <div className="grid grid-cols-2 gap-3 min-[480px]:grid-cols-3">
                      {products
                        .filter((p) => !p.category_id)
                        .map((p, idx) => renderProduct(p, idx === 0 && categories.length === 0))}
                    </div>
                  </section>
                )}
              </>
            ) : (
              /* Single category: flat list */
              <div className="grid grid-cols-2 gap-3 min-[480px]:grid-cols-3">
                {filtered.map((p, idx) => renderProduct(p, idx === 0))}
              </div>
            )}
          </>
        )}
      </main>

      {/* CART FLOATING BAR — ink bar (mockup), primary accents */}
      {cartBadge && (
        <div className="fixed inset-x-0 bottom-0 z-[var(--z-sticky)] p-3 pb-safe-bottom">
          <div className="mx-auto w-full max-w-[480px] px-1 pb-1">
            <button
              type="button"
              onClick={() => setCartOpen(true)}
              className="relative flex w-full items-center justify-between gap-3 rounded-[var(--radius-lg)] bg-[var(--color-text)] px-4 py-3 text-white shadow-float transition-transform active:scale-[0.98]"
            >
              <span className="flex items-center gap-2.5">
                <span className="flex h-[26px] w-[26px] items-center justify-center rounded-full bg-[var(--color-primary)] font-mono text-[12.5px] font-bold tabular-nums text-white">
                  {itemCount}
                </span>
                <span className="text-[13.5px] font-semibold text-white/85">السلة</span>
              </span>
              <span className="flex items-center gap-3">
                <span className="font-mono text-[14px] font-bold tabular-nums text-white" dir="ltr">
                  {formatMoney(total, currency)}
                </span>
                <span className="rounded-[var(--radius-md)] bg-[var(--color-primary)] px-4 py-2.5 text-[13px] font-bold text-white">
                  {orderingEnabled ? 'إتمام الطلب' : 'مسح الرمز'}
                </span>
              </span>
            </button>
          </div>
        </div>
      )}

      {/* PRODUCT PICKER SHEET */}
      {picker && (
        <Sheet onClose={() => setPicker(null)} title={picker.name}>
          {picker.description && (
            <p className="mb-3 text-sm text-[var(--color-text-secondary)]">
              {picker.description}
            </p>
          )}
          <p className="mb-3 text-base font-bold" style={{ color: "var(--color-primary)" }} aria-live="polite">
            {formatMoney(pickerTotal, currency)}
          </p>
          {pickerGroups.length > 0 && (
            <div className="mb-4 space-y-4">
              {pickerGroups.map((group) => {
                const choices = availableChoices(group);
                const bounds = effectiveBounds(group);
                const single = bounds.max === 1;
                const pickedInGroup = choices.filter((c) => selectedOptions.includes(c.id)).length;
                return (
                  <div key={group.id} role={single ? 'radiogroup' : 'group'} aria-label={group.name}>
                    <p className="section-title flex flex-wrap items-center gap-2">
                      {group.name}
                      {bounds.min >= 1 && (
                        <span className="rounded-full bg-[var(--color-primary-tint)] px-2 py-0.5 text-[11.5px] font-bold text-[var(--color-primary)]">
                          إلزامي
                        </span>
                      )}
                      {!single && (
                        <span className="text-[11.5px] font-normal text-[var(--color-text-muted)]">
                          {pickedInGroup}/{bounds.max} — اختر حتى {bounds.max}
                        </span>
                      )}
                    </p>
                    <ul className="space-y-2">
                      {choices.map((choice) => {
                        const on = selectedOptions.includes(choice.id);
                        return (
                          <li key={choice.id}>
                            <button
                              type="button"
                              role={single ? 'radio' : 'checkbox'}
                              aria-checked={on}
                              onClick={() => toggleOption(group, choice.id)}
                              className={`flex min-h-[48px] w-full items-center justify-between gap-2 rounded-[var(--radius-md)] border px-3 py-2.5 text-sm transition-colors ${
                                on
                                  ? 'border-[var(--color-primary)] bg-[var(--color-primary-tint)] font-semibold'
                                  : 'border-[var(--color-border)] hover:border-[var(--color-border-strong)]'
                              }`}
                            >
                              <span className="flex items-center gap-2">
                                <span
                                  aria-hidden="true"
                                  className={`flex h-4.5 w-4.5 items-center justify-center border ${
                                    single ? 'rounded-full' : 'rounded-[4px]'
                                  } ${on ? 'border-[var(--color-primary)] bg-[var(--color-primary)] text-white' : 'border-[var(--color-border-strong)]'}`}
                                  style={{ height: '18px', width: '18px' }}
                                >
                                  {on && <Check className="h-3 w-3" />}
                                </span>
                                {choice.name}
                              </span>
                              <span className="shrink-0 text-xs text-[var(--color-text-secondary)]">
                                {Number(choice.price) > 0
                                  ? `+${formatMoney(Number(choice.price), currency)}`
                                  : 'بدون زيادة'}
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
          )}
          <div className="field">
            <label htmlFor="item-notes" className="label">ملاحظة على الصنف</label>
            {/* UX-6: quick-note chips — most common Gulf requests, one tap
                each. Toggle adds/removes the phrase from the notes text. */}
            <div className="mb-2 flex flex-wrap gap-1.5" role="group" aria-label="ملاحظات سريعة">
              {QUICK_NOTE_CHIPS.map((note) => {
                const on = itemNotes.includes(note);
                return (
                  <button
                    key={note}
                    type="button"
                    onClick={() => toggleQuickNote(note)}
                    aria-pressed={on}
                    className={`min-h-[44px] rounded-full border px-3.5 text-[12.5px] font-semibold transition-colors ${
                      on
                        ? 'border-[var(--color-primary)] bg-[var(--color-primary-tint)] text-[var(--color-primary)]'
                        : 'border-[var(--color-border-strong)] bg-[var(--color-surface)] text-[var(--color-text-secondary)]'
                    }`}
                  >
                    {note}
                  </button>
                );
              })}
            </div>
            <input
              id="item-notes"
              className="input"
              value={itemNotes}
              onChange={(e) => {
                if (e.target.value.length <= 200) setItemNotes(e.target.value);
              }}
              placeholder="مثال: بدون سكر"
              maxLength={200}
            />
            <p className="hint">{itemNotes.length}/200</p>
          </div>
          <Button
            block
            disabled={pickerViolation !== null}
            onClick={confirmAdd}
            style={{ background: "var(--color-primary)" }}
          >
            أضف إلى السلة
          </Button>
          {pickerViolation && (
            <p role="alert" className="mt-2 text-center text-[12.5px] font-semibold text-[var(--color-danger)]">
              {pickerViolation.message}
            </p>
          )}
        </Sheet>
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
