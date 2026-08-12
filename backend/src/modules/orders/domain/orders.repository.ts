import type { Order, SellerOrder } from '@prisma/client';

export type OrderWithSellerOrders = Order & { sellerOrders: SellerOrder[] };

// Read-only for now. The write side (createFromCart, updateSellerOrderStatus
// + parent-status recompute) is intentionally left undefined here — its
// exact shape is part of the checkout/status-transition business logic
// this module defers, not something to guess at during scaffolding.
export abstract class OrdersRepository {
  abstract findByBuyerId(buyerId: string): Promise<OrderWithSellerOrders[]>;
  abstract findById(id: string): Promise<OrderWithSellerOrders | null>;
  abstract findSellerOrderById(id: string): Promise<SellerOrder | null>;
}
