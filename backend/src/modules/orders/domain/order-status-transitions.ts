import { SellerOrderStatus } from '@prisma/client';

// Explicit valid SellerOrder transitions for the normal, SELF-service
// path (a seller acting on their own shipment):
//   NEW -> PROCESSING -> SHIPPED -> COMPLETED
//   NEW -> CANCELLED
//   PROCESSING -> CANCELLED
// COMPLETED and CANCELLED are terminal here, and REFUNDED (a legacy,
// unproduced value — see schema.prisma) has no valid transitions either
// way.
//
// An ADMIN gets one deliberate override on top of this table — see
// canAdminForceCancel below and OrdersService.updateSellerOrderStatus —
// rather than a second, separately-maintained transition matrix.
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

// The one thing a seller cannot do that an admin can: cancel a shipment
// that has already gone out, or one already marked complete. This is
// what a dispute resolution actually needs — "the buyer never received
// it" or "this was ruled in the buyer's favour" has to be enactable
// after the fact, not only while the order is still sitting in the
// warehouse. A seller keeps the ordinary table above unchanged, so they
// can't unilaterally cancel a shipment that already left.
//
// Deliberately excludes CANCELLED and REFUNDED as the FROM state: both
// are already terminal, and "cancel a cancelled order" has no meaning.
export function canAdminForceCancel(from: SellerOrderStatus): boolean {
  return (
    from === SellerOrderStatus.SHIPPED || from === SellerOrderStatus.COMPLETED
  );
}
