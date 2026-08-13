// Fans out to TWO queues (see infrastructure/outbox/event-queue-map.ts):
// ORDER_PROCESSING (auto-advance NEW -> PROCESSING) and NOTIFICATIONS
// (tell the seller). sellerUserId is included directly so the
// notifications consumer never needs to resolve SellerProfile -> User
// itself — it stays standalone, importing no other business module (see
// the backend-architecture skill).
export const SELLER_ORDER_CREATED_EVENT = 'SellerOrderCreated';

export interface SellerOrderCreatedEvent {
  sellerOrderId: string;
  orderId: string;
  sellerId: string;
  sellerUserId: string;
}
