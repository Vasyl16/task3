import type { SellerOrderStatus } from '@prisma/client';

export const SELLER_ORDER_STATUS_CHANGED_EVENT = 'SellerOrderStatusChanged';

export interface SellerOrderStatusChangedEvent {
  sellerOrderId: string;
  orderId: string;
  status: SellerOrderStatus;
}
