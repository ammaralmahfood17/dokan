import { describe, expect, it } from 'vitest';
import { isPendingOrderSyncMessage } from './pwa-events';

describe('isPendingOrderSyncMessage', () => {
  it('accepts a complete submitted-order message', () => {
    expect(
      isPendingOrderSyncMessage({
        type: 'PENDING_ORDER_SUBMITTED',
        id: 'request-1',
        order: {
          id: 'order-1',
          status: 'pending',
          totalAmount: 4.5,
          orderNumber: 12,
        },
      })
    ).toBe(true);
  });

  it('accepts a permanent failure message', () => {
    expect(
      isPendingOrderSyncMessage({
        type: 'PENDING_ORDER_FAILED',
        id: 'request-1',
        error: 'المنتج غير متاح',
      })
    ).toBe(true);
  });

  it('rejects malformed service-worker messages', () => {
    expect(isPendingOrderSyncMessage(null)).toBe(false);
    expect(isPendingOrderSyncMessage({ type: 'PENDING_ORDER_SUBMITTED' })).toBe(false);
    expect(
      isPendingOrderSyncMessage({
        type: 'PENDING_ORDER_SUBMITTED',
        id: 'request-1',
        order: { id: 'order-1', totalAmount: '4.5' },
      })
    ).toBe(false);
  });
});
