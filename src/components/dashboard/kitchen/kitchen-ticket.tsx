'use client';

// FIX-C-002: KitchenTicket — extracted from kitchen-client.tsx.
// One kitchen order card. Calm Surface v1.1: thin neutral border normally,
// 2px danger border + red timer + "متأخر" badge when overdue (the 3-layer
// overdue rule), timing badge (warn ≥5min), qty boxes, stage actions.
import { ORDER_TYPE_LABELS, type OrderStatus, type OrderType } from '@/lib/types';

// FIX-C-002: أنواع محلية مستقلة (بنية التذكرة كما تصل من الـ parent)
export type KitchenTicketLine = {
  key: string;
  quantity: number;
  productName: string;
  addons: { name: string }[];
  notes: string | null;
};

export type KitchenTicketData = {
  order: {
    id: string;
    status: string;
    created_at: string;
    order_number: number;
    type: string;
    notes: string | null;
    tables?: { number: number } | null;
  };
  lines: KitchenTicketLine[];
  totalQty: number;
};

export const OVERDUE_MIN_PENDING = 15;
export const OVERDUE_MIN_PREPARING = 30;

export function KitchenTicket({
  ticket,
  now,
  onStart,
  onReady,
  onDeliver,
}: {
  ticket: KitchenTicketData;
  /**
   * Wall clock from the board, or **null** on the server and on the first client
   * render — it is filled in a mount effect (see kitchen-client.tsx). Null means
   * "not known yet": no elapsed time and no overdue badge. Computing it here from
   * Date.now() instead would make the server HTML and the first client render
   * disagree, which is React error #418.
   */
  now: number | null;
  onStart: () => void;
  onReady: () => void;
  onDeliver: () => void;
}) {
  const { order, lines } = ticket;
  const status = order.status as OrderStatus;
  // Guard against a malformed/absent created_at — a NaN diff would silently
  // read "قبل NaN دقيقة" and never flag overdue.
  const createdMs = new Date(order.created_at).getTime();
  const timeKnown = now !== null && Number.isFinite(createdMs);
  const mins = timeKnown ? Math.max(0, Math.floor((now - createdMs) / 60000)) : 0;

  let overdue = false;
  if (status === 'pending' && mins >= OVERDUE_MIN_PENDING) overdue = true;
  if (status === 'preparing' && mins >= OVERDUE_MIN_PREPARING) overdue = true;

  // Localized service label: `طاولة 01` / `سفري 07` / `سيارة 12`.
  // The WORD must stay RTL while the IDENTIFIER must stay LTR — hence the two
  // spans in the render below (a single dir="ltr" paragraph used to reverse
  // the Arabic word's reading order).
  const typeLabel =
    ORDER_TYPE_LABELS[order.tables ? 'dinein' : (order.type as OrderType)] ?? order.type;
  const labelNumber = String(order.tables ? order.tables.number : order.order_number).padStart(
    2,
    '0'
  );

  return (
    /* AR-4: اسم وصفي للتذكرة لقارئ الشاشة (رقم الطلب + التأخر) */
    <article
      aria-label={`طلب رقم ${order.order_number}${overdue ? ' - متأخر' : ''}`}
      className={`rounded-[var(--radius-lg)] bg-[var(--color-surface)] p-3.5 ${
        overdue ? 'border-2 border-[var(--color-danger)]' : 'border border-[var(--color-border)]'
      }`}
    >
      {/* Head — mockup: big order number + table label, ⏱ timer */}
      <div className="mb-2 flex items-start justify-between gap-2">
        <div>
          <p
            className="font-mono text-[14.5px] font-extrabold tabular-nums text-[var(--color-text)]"
            dir="ltr"
          >
            #{String(order.order_number).padStart(3, '0')}
          </p>
          <p className="mt-0.5 text-[12px] font-semibold text-[var(--color-text-secondary)]">
            {typeLabel}{' '}
            <span className="font-mono tabular-nums" dir="ltr">
              {labelNumber}
            </span>
          </p>
        </div>
        <p
          className={`text-[12px] font-bold tabular-nums ${overdue ? 'text-[var(--color-danger)]' : 'text-[var(--color-text-tertiary)]'}`}
          dir="ltr"
        >
          {/* The clock glyph keeps the width stable while the value is unknown, so
              the row does not jump when the real minutes land after mount. */}
          {timeKnown ? `⏱ ${mins} د` : '⏱ —'}
        </p>
      </div>

      {/* Timing badge — warn ≥5min, danger 3-layer when overdue */}
      {overdue ? (
        <span className="mb-2.5 inline-block rounded-full bg-[var(--color-danger-tint)] px-2.5 py-0.5 text-[11px] font-bold text-[var(--color-danger)]">
          ⏱ متأخر — {mins} د
        </span>
      ) : mins >= 5 ? (
        <span className="mb-2.5 inline-block rounded-full bg-[var(--color-warn-tint)] px-2.5 py-0.5 text-[11px] font-bold text-[var(--color-warn)]">
          ⏱ {mins} د
        </span>
      ) : null}

      {/* Items — mockup: qty box + name, addons/notes indented under */}
      <ul className="mb-3 list-none space-y-1.5 p-0">
        {lines.map((l) => (
          <li key={l.key} className="text-[13.5px]">
            <div className="flex items-center gap-2">
              <span
                className="flex h-[22px] w-[22px] shrink-0 items-center justify-center rounded-[6px] bg-[var(--color-primary-tint)] font-mono text-[12px] font-extrabold tabular-nums text-[var(--color-primary)]"
                dir="ltr"
              >
                {l.quantity}×
              </span>
              <span className="font-semibold">{l.productName}</span>
            </div>
            {l.addons.length > 0 && (
              <p className="ms-[30px] mt-0.5 text-[11.5px] text-[var(--color-text-tertiary)]">
                {l.addons.map((a) => a.name).join(' · ')}
              </p>
            )}
            {l.notes && (
              <p className="ms-[30px] mt-0.5 text-[11.5px] text-[var(--color-text-tertiary)]">
                ملاحظة: {l.notes}
              </p>
            )}
          </li>
        ))}
        {order.notes && (
          <li className="mt-1.5 rounded-[var(--radius-md)] bg-[var(--color-bg)] px-2 py-1.5 text-[11.5px] text-[var(--color-danger)]">
            {order.notes}
          </li>
        )}
      </ul>

      {/* Actions — one primary per stage; ghost "تأخير" only while cooking */}
      <div className="flex gap-2">
        {status === 'pending' && (
          <button
            type="button"
            onClick={onStart}
            className="min-h-[44px] flex-1 rounded-[10px] bg-[var(--color-primary)] px-4 text-[13px] font-bold text-white transition-colors hover:bg-[var(--color-primary-hover)]"
          >
            بدء التحضير
          </button>
        )}
        {status === 'preparing' && (
          <button
            type="button"
            onClick={onReady}
            className="min-h-[44px] flex-1 rounded-[10px] bg-[var(--color-success-tint)] px-4 text-[13px] font-bold text-[var(--color-success)] transition-colors hover:bg-[var(--color-success)] hover:text-white"
          >
            جاهز للتسليم
          </button>
        )}
        {status === 'ready' && (
          <button
            type="button"
            onClick={onDeliver}
            className="min-h-[44px] flex-1 rounded-[10px] bg-[var(--color-bg)] px-4 text-[13px] font-bold text-[var(--color-text-tertiary)] transition-colors hover:bg-[var(--color-border)] hover:text-[var(--color-text)]"
          >
            تم التسليم ✓
          </button>
        )}
      </div>
    </article>
  );
}
