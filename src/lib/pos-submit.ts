import { classifyFailure, type SubmitOutcome } from '@/lib/pos-offline-queue';

/**
 * One place that posts a POS order — used by the live submit AND by the offline
 * queue's flush, so a retry cannot behave differently from the first attempt.
 *
 * A thrown fetch (the network died mid-request) is reported as `status: null`
 * and classified as retryable: the request may never have left the device, and
 * the idempotency key makes a duplicate send harmless.
 */
export type PosSubmitPayload = {
  projectId: string;
  clientRequestId: string;
  type: 'walkin' | 'drivethru' | 'dinein';
  /** Dine-in only: the table this order belongs to (joins its live session). */
  tableId?: string | null;
  notes?: string;
  items: Array<{ productId: string; quantity: number; optionIds: string[] }>;
};

export type PosSubmitResult =
  | { ok: true; order: { id: string; totalAmount: number; orderNumber: number } }
  | { ok: false; status: number | null; error: string; outcome: SubmitOutcome };

export async function postPosOrder(
  payload: PosSubmitPayload,
  fetchImpl: typeof fetch = fetch
): Promise<PosSubmitResult> {
  let res: Response;
  try {
    res = await fetchImpl('/api/pos/order', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify(payload),
    });
  } catch {
    return { ok: false, status: null, error: 'تعذّر الاتصال — حُفظ الطلب وسيُرسل تلقائيًا', outcome: 'retry' };
  }

  const data = (await res.json().catch(() => null)) as {
    error?: string;
    order?: { id: string; totalAmount: number; orderNumber: number };
  } | null;

  if (!res.ok || !data?.order) {
    const status = res.status;
    return {
      ok: false,
      status,
      error: data?.error || (status >= 500 ? 'الخادم مشغول — سيُعاد المحاولة' : 'فشل إنشاء الطلب'),
      outcome: classifyFailure(status),
    };
  }

  return { ok: true, order: data.order };
}
