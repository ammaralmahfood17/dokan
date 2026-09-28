export const PENDING_ORDER_EVENT = 'dokan:pending-order';

type SubmittedOrder = {
  id: string;
  status: string;
  totalAmount: number;
  orderNumber: number;
};

export type PendingOrderSyncMessage =
  | {
      type: 'PENDING_ORDER_SUBMITTED';
      id: string;
      order: SubmittedOrder | null;
    }
  | {
      type: 'PENDING_ORDER_FAILED';
      id: string;
      error: string;
    };

export function isPendingOrderSyncMessage(
  value: unknown
): value is PendingOrderSyncMessage {
  if (!value || typeof value !== 'object') return false;
  const message = value as Record<string, unknown>;
  if (typeof message.id !== 'string') return false;

  if (message.type === 'PENDING_ORDER_FAILED') {
    return typeof message.error === 'string';
  }
  if (message.type !== 'PENDING_ORDER_SUBMITTED') return false;
  if (message.order === null) return true;
  if (!message.order || typeof message.order !== 'object') return false;

  const order = message.order as Record<string, unknown>;
  return (
    typeof order.id === 'string' &&
    typeof order.status === 'string' &&
    typeof order.totalAmount === 'number' &&
    typeof order.orderNumber === 'number'
  );
}
