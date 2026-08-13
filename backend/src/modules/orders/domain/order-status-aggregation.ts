import { OrderStatus, SellerOrderStatus } from '@prisma/client';

// The parent Order's status is DERIVED from the set of its SellerOrders'
// statuses — never written independently (see schema.prisma). Rules are
// applied in this order (first match wins), and MUST be recomputed
// synchronously, in the same transaction as whichever SellerOrder status
// change triggered it — see OrdersService.recomputeOrderStatus.
//
//  1. Every SellerOrder is CANCELLED                       -> CANCELLED
//  2. Every SellerOrder is COMPLETED or CANCELLED,
//     and at least one is CANCELLED                        -> PARTIALLY_CANCELLED
//  3. Every SellerOrder is COMPLETED (none cancelled)       -> COMPLETED
//  4. Every SellerOrder has at least SHIPPED
//     (SHIPPED, COMPLETED, or CANCELLED covers all of them) -> SHIPPED
//  5. At least one SellerOrder has SHIPPED or COMPLETED,
//     but not all of them                                  -> PARTIALLY_SHIPPED
//  6. At least one SellerOrder is PROCESSING, or a mix of
//     CANCELLED and still-untouched NEW ones exists         -> PROCESSING
//  7. Otherwise — every SellerOrder is still NEW            -> NEW
export function aggregateOrderStatus(
  sellerOrderStatuses: SellerOrderStatus[],
): OrderStatus {
  const total = sellerOrderStatuses.length;
  const count = (status: SellerOrderStatus) =>
    sellerOrderStatuses.filter((s) => s === status).length;

  const cancelled = count(SellerOrderStatus.CANCELLED);
  const completed = count(SellerOrderStatus.COMPLETED);
  const shipped = count(SellerOrderStatus.SHIPPED);
  const processing = count(SellerOrderStatus.PROCESSING);

  if (cancelled === total) {
    return OrderStatus.CANCELLED;
  }
  if (completed + cancelled === total) {
    return cancelled > 0
      ? OrderStatus.PARTIALLY_CANCELLED
      : OrderStatus.COMPLETED;
  }
  if (shipped + completed + cancelled === total) {
    return OrderStatus.SHIPPED;
  }
  if (shipped + completed > 0) {
    return OrderStatus.PARTIALLY_SHIPPED;
  }
  if (processing > 0 || cancelled > 0) {
    return OrderStatus.PROCESSING;
  }
  return OrderStatus.NEW;
}
