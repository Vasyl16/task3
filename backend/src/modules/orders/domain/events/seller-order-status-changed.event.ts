import type { OrderStatus, SellerOrderStatus } from '@prisma/client';

// Recorded on EVERY SellerOrder status change, including the
// asynchronous NEW -> PROCESSING advance driven by
// OrderProcessingConsumer — otherwise a subscriber watching an order
// would silently miss that first transition.
//
// orderStatus is the parent Order's freshly-recomputed aggregate (see
// domain/order-status-aggregation.ts), included so a client watching
// order:{orderId} gets both halves of the change in one message and
// never has to infer the parent status itself.
export const SELLER_ORDER_STATUS_CHANGED_EVENT = 'SellerOrderStatusChanged';

export interface SellerOrderStatusChangedEvent {
  sellerOrderId: string;
  orderId: string;
  status: SellerOrderStatus;
  orderStatus: OrderStatus;
}
