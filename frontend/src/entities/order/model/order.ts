import type { ProductStatus } from '../../product';

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

// A purchased line, with just enough product context to render it and
// link through to the product page. Product name/image are the LIVE
// values (unlike unitPrice, which is snapshotted at purchase), so the
// link always leads somewhere real.
export interface OrderItem {
  id: string;
  sellerOrderId: string;
  productId: string;
  quantity: number;
  unitPrice: string;
  createdAt: string;
  product: {
    id: string;
    name: string;
    slug: string;
    imageUrl: string | null;
    status: ProductStatus;
  };
}

export interface SellerOrderWithItems extends SellerOrder {
  items: OrderItem[];
}

export interface OrderWithSellerOrders extends Order {
  sellerOrders: SellerOrderWithItems[];
}

// What POST /orders/checkout returns: the rows it just created, WITHOUT
// line items. Deliberately a distinct type from the read model above —
// they are not interchangeable, and treating them as one is exactly what
// let an item-less order reach a component expecting items.
export interface OrderCheckoutResult extends Order {
  sellerOrders: SellerOrder[];
}

// GET /orders/seller-orders — the seller dashboard's own-SellerOrders
// list. Minimal parent-order context only (id/status/placedAt): a
// seller sees which order a line belongs to, not the buyer's identity
// or any other seller's lines from the same multi-vendor order.
export interface SellerOrderWithOrderContext extends SellerOrderWithItems {
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

export interface AdminListOrdersParams {
  status?: OrderStatus;
  buyerId?: string;
  search?: string;
  page?: number;
  limit?: number;
}
