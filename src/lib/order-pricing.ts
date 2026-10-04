import type { SupabaseClient } from '@supabase/supabase-js';
import type { Database, Json } from '@/lib/database.types';
import type { OrderItemAddon, OrderType, PublicOrderItemInput } from '@/lib/types';
import { money, currencyDecimals } from '@/lib/utils';

type AdminClient = SupabaseClient<Database>;

export type ValidatedOrderLine = {
  product_id: string;
  product_name: string;
  quantity: number;
  unit_price: number;
  addons: OrderItemAddon[];
  notes: string | null;
};

export type CreateOrderResult =
  | {
      ok: true;
      order: {
        id: string;
        status: string;
        totalAmount: number;
        orderNumber: number;
        /**
         * True when the idempotency key had already been used, so the RPC
         * returned the EXISTING order instead of creating a second one
         * (migration 0014). The caller must skip side effects (audit, push,
         * Telegram) in that case — the customer was already notified the first
         * time, and a replay must not re-notify the merchant.
         */
        replayed: boolean;
      };
    }
  | { ok: false; error: string; status: number };

/**
 * Shared server-side order creation:
 * - Re-validates project + optional table
 * - Fetches real product/addon prices
 * - Recalculates total_amount
 * - Inserts order + order_items
 *
 * Used by public order API and POS.
 */
export async function createSecureOrder(
  supabase: AdminClient,
  params: {
    projectId: string;
    currency?: string;
    tableId: string | null;
    type: OrderType;
    items: PublicOrderItemInput[];
    notes?: string | null;
    /** Authenticated staff id — passed to the RPCs so the DB-side
     *  membership guard can verify the caller. Omit for the anonymous
     *  public-order path (route-level validation applies there). */
    callerUserId?: string;
    /**
     * Idempotency key (migration 0014). When the SAME key is seen twice for
     * this project the RPC returns the original order instead of creating a
     * second one, which is what makes the offline-retry path safe. Omit for
     * internal calls (POS/waiter/bill) — NULL is excluded from the unique
     * index, so those are never constrained.
     */
    clientRequestId?: string | null;
  }
): Promise<CreateOrderResult> {
  const { projectId, currency, tableId, type, items, notes, callerUserId, clientRequestId } =
    params;
  // Server-side rounding per the project's currency (BHD=3, SAR/AED/QAR=2…)
  const decimals = currencyDecimals(currency ?? 'BHD');

  if (!items.length) {
    return { ok: false, error: 'السلة فارغة', status: 400 };
  }

  if (items.length > 50) {
    return { ok: false, error: 'عدد الأصناف كبير جداً', status: 400 };
  }

  // Order-level notes share the menu's 500-char limit (item notes: 200).
  // Guard the type first — a numeric/object notes value would throw inside
  // .trim()/.length and surface as a 500 instead of a clean 400.
  const orderNotes = typeof notes === 'string' ? notes : '';
  if (orderNotes.length > 500) {
    return { ok: false, error: 'ملاحظات الطلب طويلة جداً (الحد 500 حرف)', status: 400 };
  }

  const validated: ValidatedOrderLine[] = [];
  let totalAmount = 0;

  // ── Bulk pre-fetch (latency fix) ─────────────────────────────────────
  // The old per-item loop fired 2 sequential queries PER line (product
  // fetch + addons fetch) — a 3-item order = 6 round-trips ≈ 1.5s of pure
  // query time (each ~250ms Vercel→Supabase). Fetch ALL products and ALL
  // addons in two parallel queries instead, then resolve lines in memory.
  const productIds = [...new Set(items.map((i) => String(i.productId).trim()))];
  const addonIds = [
    ...new Set(
      items.flatMap((i) =>
        (Array.isArray(i.addonIds) ? i.addonIds : []).map((a) => String(a).trim())
      )
    ),
  ];

  const [productsRes, addonsRes] = await Promise.all([
    supabase
      .from('products')
      .select('id, name, price, is_available, project_id')
      .in('id', productIds)
      .eq('project_id', projectId),
    addonIds.length > 0
      ? supabase
          .from('product_addons')
          .select('id, name, price, is_available, product_id')
          .in('id', addonIds)
          .eq('is_available', true)
      : Promise.resolve({ data: [] as never[] }),
  ]);
  const productsById = new Map((productsRes.data ?? []).map((p) => [p.id, p]));
  // Group addons by product so each line can validate its own set.
  const addonsByProduct = new Map<string, NonNullable<typeof addonsRes.data>[number][]>();
  for (const a of addonsRes.data ?? []) {
    const list = addonsByProduct.get(a.product_id) ?? [];
    list.push(a);
    addonsByProduct.set(a.product_id, list);
  }

  for (const item of items) {
    const quantity = Number(item.quantity);
    // Require a positive integer quantity (reject 1.5, NaN, etc.)
    if (
      !item.productId ||
      !Number.isFinite(quantity) ||
      !Number.isInteger(quantity) ||
      quantity <= 0
    ) {
      return { ok: false, error: 'بيانات صنف غير صالحة', status: 400 };
    }
    if (quantity > 99) {
      return { ok: false, error: 'الكمية غير مسموحة', status: 400 };
    }

    // Additional input hardening (Phase 1) — type-guard item notes too
    const itemNotes = typeof item.notes === 'string' ? item.notes : '';
    if (itemNotes.length > 200) {
      return { ok: false, error: 'ملاحظات الصنف طويلة جداً (الحد 200 حرف)', status: 400 };
    }

    const product = productsById.get(String(item.productId).trim());

    if (!product || !product.is_available) {
      return {
        ok: false,
        error: 'منتج غير متاح أو لا ينتمي لهذا المتجر',
        status: 400,
      };
    }

    const addonIdsForLine = Array.isArray(item.addonIds) ? item.addonIds.map((a) => String(a).trim()) : [];
    const addonDetails: OrderItemAddon[] = [];
    let addonTotal = 0;

    if (addonIdsForLine.length > 0) {
      // Only addons belonging to THIS product, from the pre-fetched set.
      const productAddons = (addonsByProduct.get(product.id) ?? []).filter((a) =>
        addonIdsForLine.includes(a.id)
      );
      const found = productAddons;

      // Reject if any requested addon is missing or wrong product
      if (found.length !== addonIdsForLine.length) {
        return {
          ok: false,
          error: 'إضافة غير صالحة',
          status: 400,
        };
      }

      for (const addon of found) {
        const price = money(Number(addon.price), decimals);
        addonTotal = money(addonTotal + price, decimals);
        addonDetails.push({
          id: addon.id,
          name: addon.name,
          price,
        });
      }
    }

    const unitPrice = money(Number(product.price) + addonTotal, decimals);
    const lineTotal = money(unitPrice * quantity, decimals);
    totalAmount = money(totalAmount + lineTotal, decimals);

    validated.push({
      product_id: product.id,
      product_name: product.name,
      quantity,
      unit_price: unitPrice,
      addons: addonDetails,
      notes: itemNotes.trim() || null,
    });
  }

  // One transactional RPC: order + order_items inserted atomically.
  // (The previous two-step insert had a crash window that could leave an
  // orphan order with no items — the manual delete rollback was best-effort.)
  //
  // The order number is NOT pre-allocated here any more. Passing 0 arms the
  // trg_orders_auto_number trigger, which allocates it INSIDE this
  // transaction — so the daily counter's business day and the row's
  // created_at are derived from one transaction timestamp (now() is
  // transaction-fixed) and can never disagree across midnight. A failed
  // create also no longer burns a counter slot.
  //
  // Prices/names/addons below are advisory: migration 0017 makes the RPC
  // recompute every line from LIVE product/addon rows (FOR SHARE) and take
  // the total from that recomputation, so a merchant edit between our read
  // and this insert is either serialised against the order or rejected as
  // sold out — never silently accepted at the stale price.
  const { data: created, error: createErr } = await supabase.rpc(
    'create_order_transactional',
    {
      p_project_id: projectId,
      p_table_id: tableId ?? undefined,
      p_type: type,
      p_status: 'pending',
      p_total_amount: totalAmount,
      p_notes: orderNotes.trim() || undefined,
      p_order_number: 0,
      p_caller_user_id: callerUserId,
      p_client_request_id: clientRequestId ?? null,
      p_items: validated.map((line) => ({
        product_id: line.product_id,
        product_name: line.product_name,
        quantity: line.quantity,
        unit_price: line.unit_price,
        addons: line.addons as unknown as Json,
        notes: line.notes,
      })),
    }
  );

  if (createErr || !created) {
    const msg = createErr?.message ?? '';
    // Migration 0017 rejections — the item/addon went unavailable (or was
    // never ours) between the read above and the insert. A clean 409 tells
    // the customer to refresh the menu instead of charging them for
    // something the kitchen cannot make.
    if (msg.includes('ITEM_UNAVAILABLE')) {
      return { ok: false, error: 'أحد الأصناف لم يعد متوفراً — حدّث القائمة', status: 409 };
    }
    if (msg.includes('ADDON_UNAVAILABLE')) {
      return { ok: false, error: 'إضافة لم تعد متوفرة — حدّث القائمة', status: 409 };
    }
    if (
      msg.includes('PRODUCT_NOT_FOUND') ||
      msg.includes('INVALID_LINE') ||
      msg.includes('EMPTY_CART')
    ) {
      return { ok: false, error: 'بيانات صنف غير صالحة', status: 400 };
    }
    console.error('Order create error:', createErr);
    return { ok: false, error: 'فشل إنشاء الطلب', status: 500 };
  }

  const createdOrder = created as {
    id: string;
    status: string;
    total_amount: number;
    order_number: number;
    // Present since migration 0014. Default to false so a response from an
    // older DB (migration not yet applied) can't be mistaken for a replay.
    replayed?: boolean;
  };

  return {
    ok: true,
    order: {
      id: createdOrder.id,
      status: createdOrder.status,
      totalAmount: money(Number(createdOrder.total_amount), decimals),
      orderNumber: Number(createdOrder.order_number),
      replayed: createdOrder.replayed === true,
    },
  };
}
