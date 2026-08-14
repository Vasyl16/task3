export type OrderStatus =
  | 'NEW'
  | 'PROCESSING'
  | 'PARTIALLY_SHIPPED'
  | 'SHIPPED'
  | 'COMPLETED'
  | 'PARTIALLY_CANCELLED'
  | 'CANCELLED';

// REFUNDED is schema-legacy — the backend never produces it (see the API
// contract notes) but a type covering only reachable values would break
// the moment an old row is read, so it stays in the union.
export type SellerOrderStatus =
  'NEW' | 'PROCESSING' | 'SHIPPED' | 'COMPLETED' | 'CANCELLED' | 'REFUNDED';

export interface Order {
  id: string;
  buyerId: string;
  status: OrderStatus;
  totalAmount: string;
  placedAt: string;
  createdAt: string;
  updatedAt: string;
}

export interface SellerOrder {
  id: string;
  orderId: string;
  sellerId: string;
  status: SellerOrderStatus;
  subtotal: string;
  shippingFee: string;
  createdAt: string;
  updatedAt: string;
}

export interface OrderWithSellerOrders extends Order {
  sellerOrders: SellerOrder[];
}

// GET /orders/seller-orders — the seller dashboard's own-SellerOrders
// list. Minimal parent-order context only (id/status/placedAt): a
// seller sees which order a line belongs to, not the buyer's identity
// or any other seller's lines from the same multi-vendor order.
export interface SellerOrderWithOrderContext extends SellerOrder {
  order: { id: string; status: OrderStatus; placedAt: string };
}

// Only forward transitions the backend actually accepts — mirrored here
// so the seller dashboard can grey out an impossible next status rather
// than let the user submit it and read the rejection back from a 400.
// This is a UX shortcut, not enforcement: the backend re-checks every
// transition regardless (see .claude/rules/frontend.md).
export const SELLER_ORDER_NEXT_STATUS: Record<
  SellerOrderStatus,
  SellerOrderStatus[]
> = {
  NEW: ['PROCESSING', 'CANCELLED'],
  PROCESSING: ['SHIPPED', 'CANCELLED'],
  SHIPPED: ['COMPLETED'],
  COMPLETED: [],
  CANCELLED: [],
  REFUNDED: [],
};
