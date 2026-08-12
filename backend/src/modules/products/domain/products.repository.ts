import type { Prisma, Product, ProductType } from '@prisma/client';

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

export abstract class ProductsRepository {
  abstract findAll(filter?: {
    categoryId?: string;
    sellerId?: string;
  }): Promise<Product[]>;
  abstract findById(id: string): Promise<Product | null>;
  // Takes the caller's transaction client — Product + Inventory must be
  // created atomically, in the same transaction as the outbox event.
  abstract createWithInventory(
    tx: Prisma.TransactionClient,
    data: CreateProductWithInventoryInput,
  ): Promise<Product>;
  abstract update(
    id: string,
    data: Partial<{ name: string; description: string; basePrice: number }>,
  ): Promise<Product>;
  // Soft delete only — sets status to ARCHIVED. Never a physical DELETE:
  // an archived product may still be referenced by existing carts,
  // OrderItems, or Auctions, and destroying the row would break that
  // history. See ProductsService.archive.
  abstract archive(id: string): Promise<Product>;
}
