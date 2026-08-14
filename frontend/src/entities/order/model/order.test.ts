import { describe, expect, it } from 'vitest';
import { SELLER_ORDER_NEXT_STATUS } from './order';
import type { SellerOrderStatus } from './order';

// Mirrors backend/src/modules/orders/domain/order-status-transitions.ts —
// this table exists purely to grey out an impossible next status in the
// seller dashboard (see the comment on SELLER_ORDER_NEXT_STATUS); the
// backend re-validates every transition regardless. If the backend's
// allowed transitions ever change, this test should force a deliberate
// update here rather than silently drifting out of sync.
describe('SELLER_ORDER_NEXT_STATUS', () => {
  it('matches the backend transition table exactly', () => {
    const expected: Record<SellerOrderStatus, SellerOrderStatus[]> = {
      NEW: ['PROCESSING', 'CANCELLED'],
      PROCESSING: ['SHIPPED', 'CANCELLED'],
      SHIPPED: ['COMPLETED'],
      COMPLETED: [],
      CANCELLED: [],
      REFUNDED: [],
    };
    expect(SELLER_ORDER_NEXT_STATUS).toEqual(expected);
  });

  it('has no transitions out of a terminal status', () => {
    for (const terminal of ['COMPLETED', 'CANCELLED', 'REFUNDED'] as const) {
      expect(SELLER_ORDER_NEXT_STATUS[terminal]).toEqual([]);
    }
  });
});
