import type {
  LedgerEntryType,
  Order,
  OrderItem,
  OrderStatus,
  Prisma,
  Product,
  SellerOrder,
  SellerOrderStatus,
} from '@prisma/client';

// Just enough product context to render a line and link to it. Name and
// image are snapshotted nowhere — unlike unitPrice, which IS snapshotted
// on the item — so these are the live values and a renamed product shows
// its current name in order history. That is the intended reading: the
// link has to lead somewhere real.
export type OrderItemWithProduct = OrderItem & {
  product: Pick<Product, 'id' | 'name' | 'slug' | 'imageUrl' | 'status'>;
};

export type SellerOrderWithItems = SellerOrder & {
  items: OrderItemWithProduct[];
};

// What checkout returns: the rows it just created, with no line items
// loaded. Kept separate from the read model below rather than making
// checkout re-query for data its caller does not use.
export type OrderWithSellerOrders = Order & { sellerOrders: SellerOrder[] };

// What the order-history reads return. Items are included so a buyer or
// seller can see what was actually bought and click through to it.
export type OrderWithSellerOrderItems = Order & {
  sellerOrders: SellerOrderWithItems[];
};

// Minimal parent-order context for a seller's own SellerOrder list — just
// enough to show which order it's part of and when it was placed,
// without exposing the buyer's identity or the OTHER sellers' lines from
// the same multi-vendor order (that's `Order`/`findById`, buyer/admin
// only).
export type SellerOrderWithOrderContext = SellerOrderWithItems & {
  order: Pick<Order, 'id' | 'status' | 'placedAt'>;
};

export interface CheckoutOrderItemInput {
  productId: string;
  quantity: number;
  unitPrice: number;
}

// One seller's slice of a checkout — becomes one SellerOrder, its
// OrderItems, and its initial SALE/COMMISSION ledger entries. subtotal
// and commission are pre-computed by OrdersService (a business/domain
// calculation — see domain/commission.ts) — the repository just persists
// what it's given, it doesn't compute money.
export interface CheckoutSellerLineInput {
  sellerId: string;
  subtotal: number;
  commission: number;
  items: CheckoutOrderItemInput[];
}

export interface CreateFromCheckoutInput {
  buyerId: string;
  totalAmount: number;
  sellerLines: CheckoutSellerLineInput[];
}

export interface CreateFromCheckoutResult {
  order: Order;
  sellerOrders: SellerOrder[];
}

export abstract class OrdersRepository {
  abstract findByBuyerId(buyerId: string): Promise<OrderWithSellerOrderItems[]>;
  abstract findById(id: string): Promise<OrderWithSellerOrderItems | null>;
  // Every order, for the admin queue. Deliberately not reachable from
  // the buyer-facing list, which is always scoped to the caller.
  abstract findAllForAdmin(filter: {
    status?: OrderStatus;
    buyerId?: string;
  }): Promise<OrderWithSellerOrderItems[]>;
  abstract findSellerOrderById(id: string): Promise<SellerOrder | null>;
  // Seller dashboard's "own SellerOrders" list — scoped by sellerId,
  // never trusted from the client (see OrdersService.findBySellerId).
  abstract findBySellerId(
    sellerId: string,
  ): Promise<SellerOrderWithOrderContext[]>;

  // Creates the parent Order, one SellerOrder + OrderItems per seller
  // line, and each SellerOrder's initial SALE/COMMISSION ledger entries —
  // all in the caller's transaction. See OrdersService.checkout /
  // executeOrderTransaction, the sole caller.
  abstract createFromCheckout(
    tx: Prisma.TransactionClient,
    input: CreateFromCheckoutInput,
  ): Promise<CreateFromCheckoutResult>;

  // Append-only reversal/adjustment entries — e.g. on SellerOrder
  // cancellation (see OrdersService.updateSellerOrderStatus). Never
  // mutates a prior entry; LedgerEntry is immutable (see schema.prisma).
  abstract createLedgerEntries(
    tx: Prisma.TransactionClient,
    entries: Array<{
      sellerId: string;
      sellerOrderId: string;
      type: LedgerEntryType;
      amount: number;
    }>,
  ): Promise<void>;

  abstract updateSellerOrderStatus(
    tx: Prisma.TransactionClient,
    id: string,
    status: SellerOrderStatus,
  ): Promise<SellerOrder>;

  // Guarded, idempotent-by-construction variant used by async consumers
  // (e.g. OrderProcessingConsumer auto-advancing NEW -> PROCESSING):
  // succeeds only if the row is still in `expectedCurrent`; returns null
  // (not an error) if a redelivered job finds the row already moved on.
  abstract updateSellerOrderStatusIfCurrent(
    tx: Prisma.TransactionClient,
    id: string,
    expectedCurrent: SellerOrderStatus,
    next: SellerOrderStatus,
  ): Promise<SellerOrder | null>;

  // The recomputed aggregate write — see domain/order-status-aggregation.ts
  // for the rules. Always called in the same transaction as the
  // SellerOrder status change that triggered it.
  abstract updateOrderStatus(
    tx: Prisma.TransactionClient,
    orderId: string,
    status: OrderStatus,
  ): Promise<Order>;

  abstract findOrderItemsForSellerOrder(
    tx: Prisma.TransactionClient,
    sellerOrderId: string,
  ): Promise<OrderItem[]>;

  // Read within the SAME transaction as the SellerOrder status write
  // that's about to trigger a parent-status recompute — see
  // domain/order-status-aggregation.ts and
  // OrdersService.recomputeOrderStatus. Reading outside the transaction
  // would risk aggregating against a state that's about to change.
  abstract findSellerOrderStatusesForOrder(
    tx: Prisma.TransactionClient,
    orderId: string,
  ): Promise<SellerOrderStatus[]>;
}
