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
  }): Promise<Product[]>;
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
    data: Partial<{ name: string; description: string; basePrice: number }>,
  ): Promise<Product>;
  // Soft delete only — sets status to ARCHIVED. Never a physical DELETE:
  // an archived product may still be referenced by existing carts,
  // OrderItems, or Auctions, and destroying the row would break that
  // history. See ProductsService.archive.
  abstract archive(tx: Prisma.TransactionClient, id: string): Promise<Product>;
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
  // OrdersService.checkout / ProductsService.decrementStockForCheckout.
  abstract findManyWithInventory(
    tx: Prisma.TransactionClient,
    ids: string[],
  ): Promise<ProductWithInventory[]>;
  // Conditional, atomic decrement: `WHERE quantityAvailable >= quantity`
  // is itself the concurrency guard (see ProductsService for why this is
  // preferred over a bare optimistic version compare-and-swap here) —
  // returns null if insufficient stock or a concurrent checkout already
  // consumed it, never a negative quantityAvailable. On success returns
  // the resulting Inventory row so the caller can record an accurate
  // InventoryUpdated event without a second read from outside the
  // transaction.
  abstract decrementStock(
    tx: Prisma.TransactionClient,
    productId: string,
    quantity: number,
  ): Promise<Inventory | null>;
  // Restores stock — e.g. when a SellerOrder is cancelled. See
  // OrdersService.updateSellerOrderStatus. Returns the resulting row for
  // the same reason decrementStock does.
  abstract restoreStock(
    tx: Prisma.TransactionClient,
    productId: string,
    quantity: number,
  ): Promise<Inventory>;
}
