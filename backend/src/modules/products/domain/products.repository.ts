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
  // Conditional, atomic decrement guarded by
  // `WHERE quantityAvailable - quantityReserved >= quantity` — itself
  // the concurrency guard (see ProductsService for why this is preferred
  // over a bare optimistic version compare-and-swap here). Returns null
  // if stock is insufficient, a concurrent checkout already consumed it,
  // or the units are held by a live auction — never a negative or
  // oversold quantityAvailable. On success returns the resulting
  // Inventory row so the caller can record an accurate InventoryUpdated
  // event without a second read from outside the transaction.
  abstract decrementStock(
    tx: Prisma.TransactionClient,
    productId: string,
    quantity: number,
  ): Promise<Inventory | null>;
  // Holds units for a live auction lot WITHOUT consuming them — stock
  // stays on hand (and visible as such) until the winner checks out.
  // Returns null when the product doesn't physically have the units.
  // Unlike decrementStock this does NOT gate on quantityReserved — see
  // the implementation for why, and BiddingService.createAuction for
  // where the "already claimed" question is actually decided.
  abstract reserveStock(
    tx: Prisma.TransactionClient,
    productId: string,
    quantity: number,
  ): Promise<Inventory | null>;
  // Frees a reserveStock hold: the auction ended with no winner, the
  // winner's checkout window lapsed, or the hold is being converted into
  // a sale. Always called behind a guarded status transition, so it
  // can't double-release.
  abstract releaseReservation(
    tx: Prisma.TransactionClient,
    productId: string,
    quantity: number,
  ): Promise<Inventory>;
  // Restores stock — e.g. when a SellerOrder is cancelled. See
  // OrdersService.updateSellerOrderStatus. Returns the resulting row for
  // the same reason decrementStock does.
  abstract restoreStock(
    tx: Prisma.TransactionClient,
    productId: string,
    quantity: number,
  ): Promise<Inventory>;

  // Seller-initiated stock correction (via ProductsService.update) —
  // distinct from decrementStock/restoreStock's relative adjustments:
  // this sets quantityAvailable to an absolute value the seller chose.
  // Still optimistically locked on `version` (see backend.md — never a
  // naive read-then-write on inventory): returns null if the row's
  // version has moved since it was read inside this same transaction
  // (a concurrent checkout/restore committed in between), so the caller
  // can reject the request rather than silently clobber it.
  abstract setStock(
    tx: Prisma.TransactionClient,
    productId: string,
    quantityAvailable: number,
  ): Promise<Inventory | null>;
}
