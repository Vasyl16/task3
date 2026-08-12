export const ORDER_PLACED_EVENT = 'OrderPlaced';

export interface OrderPlacedEvent {
  orderId: string;
  buyerId: string;
  sellerOrderIds: string[];
}
