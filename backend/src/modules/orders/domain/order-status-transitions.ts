import { SellerOrderStatus } from '@prisma/client';

// Explicit valid SellerOrder transitions:
//   NEW -> PROCESSING -> SHIPPED -> COMPLETED
//   NEW -> CANCELLED
//   PROCESSING -> CANCELLED
// COMPLETED and CANCELLED are terminal. A SellerOrder that has already
// SHIPPED can no longer be cancelled here — see
// OrdersService.updateSellerOrderStatus, and REFUNDED (a legacy,
// unproduced value — see schema.prisma) has no valid transitions either
// way.
export const VALID_SELLER_ORDER_TRANSITIONS: Record<
  SellerOrderStatus,
  SellerOrderStatus[]
> = {
  [SellerOrderStatus.NEW]: [
    SellerOrderStatus.PROCESSING,
    SellerOrderStatus.CANCELLED,
  ],
  [SellerOrderStatus.PROCESSING]: [
    SellerOrderStatus.SHIPPED,
    SellerOrderStatus.CANCELLED,
  ],
  [SellerOrderStatus.SHIPPED]: [SellerOrderStatus.COMPLETED],
  [SellerOrderStatus.COMPLETED]: [],
  [SellerOrderStatus.CANCELLED]: [],
  [SellerOrderStatus.REFUNDED]: [],
};

export function isValidSellerOrderTransition(
  from: SellerOrderStatus,
  to: SellerOrderStatus,
): boolean {
  return VALID_SELLER_ORDER_TRANSITIONS[from].includes(to);
}
