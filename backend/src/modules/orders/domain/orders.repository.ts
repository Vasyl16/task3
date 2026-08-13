import type {
  LedgerEntryType,
  Order,
  OrderItem,
  OrderStatus,
  Prisma,
  SellerOrder,
  SellerOrderStatus,
} from '@prisma/client';

export type OrderWithSellerOrders = Order & { sellerOrders: SellerOrder[] };

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
  abstract findByBuyerId(buyerId: string): Promise<OrderWithSellerOrders[]>;
  abstract findById(id: string): Promise<OrderWithSellerOrders | null>;
  abstract findSellerOrderById(id: string): Promise<SellerOrder | null>;

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
