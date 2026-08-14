import type {
  Inventory,
  Prisma,
  Product,
  ProductStatus,
  ProductType,
} from '@prisma/client';

export interface CreateProductWithInventoryInput {
  sellerId: string;
  categoryId: string;
  name: string;
  slug: string;
  description?: string;
  imageUrl?: string;
  basePrice: number;
  type: ProductType;
  initialQuantity: number;
}

export type ProductWithInventory = Product & { inventory: Inventory | null };

export abstract class ProductsRepository {
  abstract findAll(filter?: {
    categoryId?: string;
    sellerId?: string;
  }): Promise<Product[]>;
  abstract findById(id: string): Promise<Product | null>;
  // The admin moderation queue. Unlike findAll (public browsing), this
  // deliberately DOES return ARCHIVED products — a moderator has to be
  // able to see what has already been taken down in order to reinstate it.
  abstract findForModeration(filter: {
    status?: ProductStatus;
    sellerId?: string;
    search?: string;
    skip?: number;
    take?: number;
  }): Promise<{ items: Product[]; total: number }>;
  // Takes the caller's transaction client — Product + Inventory must be
  // created atomically, in the same transaction as the outbox event.
  abstract createWithInventory(
    tx: Prisma.TransactionClient,
    data: CreateProductWithInventoryInput,
  ): Promise<Product>;
  // Takes the caller's transaction client — the Product write and its
  // ProductUpdated outbox event must commit atomically. See
  // ProductsService.update.
  abstract update(
    tx: Prisma.TransactionClient,
    id: string,
    data: Partial<{
      name: string;
      description: string;
      basePrice: number;
      imageUrl: string;
    }>,
  ): Promise<Product>;
  // Soft delete only — sets status to ARCHIVED. Never a physical DELETE:
  // an archived product may still be referenced by existing carts,
  // OrderItems, or Auctions, and destroying the row would break that
  // history. See ProductsService.archive.
  abstract archive(tx: Prisma.TransactionClient, id: string): Promise<Product>;
  // The inverse of archive() — a seller putting their own listing back
  // on sale. Separate from setModerationStatus because it writes NO
  // audit trail: this is the owner's own decision, not a moderator's.
  abstract restore(tx: Prisma.TransactionClient, id: string): Promise<Product>;
  // Admin takedown/reinstatement. Writes the visibility change and the
  // audit trail (who/when/why) together — a status change with no record
  // of who made it is exactly what moderation must not produce.
  abstract setModerationStatus(
    tx: Prisma.TransactionClient,
    id: string,
    data: {
      status: ProductStatus;
      moderatedByUserId: string;
      moderationNote: string;
    },
  ): Promise<Product>;

  // Checkout support — all three take the caller's transaction client so
  // stock changes commit atomically with order creation. See
  // OrdersService.checkout / ProductsService.reserveStockForCheckout.
  abstract findManyWithInventory(
    tx: Prisma.TransactionClient,
    ids: string[],
  ): Promise<ProductWithInventory[]>;
  // Conditional, atomic RESERVATION: MOVES units from quantityAvailable
  // into quantityReserved, guarded by `WHERE quantityAvailable >=
  // quantity` — itself the concurrency guard (see ProductsService for
  // why this is preferred over a bare optimistic version compare-and-
  // swap here). The two counters are disjoint, so "what can still be
  // bought" is quantityAvailable alone and no caller subtracts anything.
  //
  // Serves an order's hold at checkout and an auction lot's hold alike:
  // both take units off sale until they are shipped or released.
  // Returns null when stock is insufficient or a concurrent reservation
  // already claimed it — never a negative quantityAvailable. On success
  // returns the resulting Inventory row so the caller can record an
  // accurate InventoryUpdated event without a second read.
  abstract reserveStock(
    tx: Prisma.TransactionClient,
    productId: string,
    quantity: number,
  ): Promise<Inventory | null>;
  // Shipping: drops quantityReserved only. quantityAvailable already
  // came down when the order was placed. Returns null when the
  // reservation is not there to consume, which is what makes a repeated
  // ship transition a no-op rather than a double decrement.
  abstract commitReservation(
    tx: Prisma.TransactionClient,
    productId: string,
    quantity: number,
  ): Promise<Inventory | null>;
  // The inverse of reserveStock — a cancelled order or an auction with
  // no winner puts its units back on sale. Null when there is no such
  // reservation, so a repeated release cannot invent stock.
  abstract releaseReservation(
    tx: Prisma.TransactionClient,
    productId: string,
    quantity: number,
  ): Promise<Inventory | null>;
  // A pure restock — quantityAvailable rises, quantityReserved untouched
  // — for the one case where a hold has already been consumed and the
  // units still need to come back on sale. See
  // ProductsService.returnStockAfterForceCancellation.
  abstract returnStock(
    tx: Prisma.TransactionClient,
    productId: string,
    quantity: number,
  ): Promise<Inventory>;

  abstract setStock(
    tx: Prisma.TransactionClient,
    productId: string,
    quantityAvailable: number,
  ): Promise<Inventory | null>;
}
