import { Injectable } from '@nestjs/common';
import {
  ProductStatus,
  type Inventory,
  type Prisma,
  type Product,
} from '@prisma/client';
import { PrismaService } from '../../../infrastructure/prisma/prisma.service';
import {
  CreateProductWithInventoryInput,
  ProductsRepository,
  ProductWithInventory,
} from '../domain/products.repository';

@Injectable()
export class PrismaProductsRepository implements ProductsRepository {
  constructor(private readonly prisma: PrismaService) {}

  findAll(filter?: {
    categoryId?: string;
    sellerId?: string;
  }): Promise<Product[]> {
    return this.prisma.product.findMany({
      where: {
        categoryId: filter?.categoryId,
        sellerId: filter?.sellerId,
        // Archived (deactivated) products never appear in browsing —
        // they still exist for cart/order history, just not discoverable.
        status: { not: ProductStatus.ARCHIVED },
      },
      orderBy: { createdAt: 'desc' },
    });
  }

  findById(id: string): Promise<Product | null> {
    return this.prisma.product.findUnique({ where: { id } });
  }

  findForModeration(filter: {
    status?: ProductStatus;
    sellerId?: string;
  }): Promise<Product[]> {
    return this.prisma.product.findMany({
      where: { status: filter.status, sellerId: filter.sellerId },
      orderBy: { createdAt: 'desc' },
    });
  }

  restore(tx: Prisma.TransactionClient, id: string): Promise<Product> {
    return tx.product.update({
      where: { id },
      data: { status: ProductStatus.ACTIVE },
    });
  }

  setModerationStatus(
    tx: Prisma.TransactionClient,
    id: string,
    data: {
      status: ProductStatus;
      moderatedByUserId: string;
      moderationNote: string;
    },
  ): Promise<Product> {
    return tx.product.update({
      where: { id },
      data: { ...data, moderatedAt: new Date() },
    });
  }

  async createWithInventory(
    tx: Prisma.TransactionClient,
    data: CreateProductWithInventoryInput,
  ): Promise<Product> {
    const product = await tx.product.create({
      data: {
        sellerId: data.sellerId,
        categoryId: data.categoryId,
        name: data.name,
        slug: data.slug,
        description: data.description,
        imageUrl: data.imageUrl,
        basePrice: data.basePrice,
        type: data.type,
        status: ProductStatus.ACTIVE,
      },
    });
    await tx.inventory.create({
      data: {
        productId: product.id,
        quantityAvailable: data.initialQuantity,
      },
    });
    return product;
  }

  update(
    tx: Prisma.TransactionClient,
    id: string,
    data: Partial<{
      name: string;
      description: string;
      basePrice: number;
      imageUrl: string;
    }>,
  ): Promise<Product> {
    return tx.product.update({ where: { id }, data });
  }

  archive(tx: Prisma.TransactionClient, id: string): Promise<Product> {
    return tx.product.update({
      where: { id },
      data: { status: ProductStatus.ARCHIVED },
    });
  }

  findManyWithInventory(
    tx: Prisma.TransactionClient,
    ids: string[],
  ): Promise<ProductWithInventory[]> {
    return tx.product.findMany({
      where: { id: { in: ids } },
      include: { inventory: true },
    });
  }

  // Reserving MOVES units out of quantityAvailable and into
  // quantityReserved. The two counters are therefore disjoint:
  //
  //   quantityAvailable = free to sell, right now
  //   quantityReserved  = spoken for, not yet shipped
  //
  // which means "what can still be bought" is quantityAvailable alone,
  // with no subtraction anywhere. That is the point of doing it this
  // way: a seller looking at their stock sees 7 the moment 3 are bought,
  // instead of a 10 that silently included units already claimed.
  //
  // `quantityAvailable >= quantity` in the WHERE IS the concurrency
  // guard: two concurrent transactions reserving the same row serialize
  // at the database (the second re-evaluates this condition against the
  // first's committed result), so this can never oversell. Raw SQL keeps
  // it to one round trip, which matters against a REMOTE database (see
  // the class comment).
  //
  // Used for BOTH an order's hold at checkout and an auction lot's hold:
  // under this model they are the same operation, and a lot that is
  // being auctioned is genuinely not available to the cart.
  async reserveStock(
    tx: Prisma.TransactionClient,
    productId: string,
    quantity: number,
  ): Promise<Inventory | null> {
    const [updated] = await tx.$queryRaw<Inventory[]>`
      UPDATE "Inventory"
      SET "quantityAvailable" = "quantityAvailable" - ${quantity},
          "quantityReserved" = "quantityReserved" + ${quantity},
          "version" = "version" + 1,
          "updatedAt" = NOW()
      WHERE "productId" = ${productId}
        AND "quantityAvailable" >= ${quantity}
      RETURNING *
    `;
    return updated ?? null;
  }

  // Shipping consumes the hold: the units leave the business entirely,
  // so quantityReserved drops and quantityAvailable is NOT touched —
  // it was already reduced when the order was placed. Adding a
  // decrement here as well would remove the same unit twice.
  //
  // Guarded on quantityReserved >= quantity, which is what makes a
  // repeated or redelivered ship transition safe: the second attempt
  // matches zero rows instead of driving the counter negative.
  async commitReservation(
    tx: Prisma.TransactionClient,
    productId: string,
    quantity: number,
  ): Promise<Inventory | null> {
    const [updated] = await tx.$queryRaw<Inventory[]>`
      UPDATE "Inventory"
      SET "quantityReserved" = "quantityReserved" - ${quantity},
          "version" = "version" + 1,
          "updatedAt" = NOW()
      WHERE "productId" = ${productId}
        AND "quantityReserved" >= ${quantity}
      RETURNING *
    `;
    return updated ?? null;
  }

  // The exact inverse of reserveStock — the order was cancelled, or an
  // auction ended with nobody to sell to, so the units go back on sale.
  // Guarded the same way, so a repeated release cannot invent stock.
  async releaseReservation(
    tx: Prisma.TransactionClient,
    productId: string,
    quantity: number,
  ): Promise<Inventory | null> {
    const [updated] = await tx.$queryRaw<Inventory[]>`
      UPDATE "Inventory"
      SET "quantityAvailable" = "quantityAvailable" + ${quantity},
          "quantityReserved" = "quantityReserved" - ${quantity},
          "version" = "version" + 1,
          "updatedAt" = NOW()
      WHERE "productId" = ${productId}
        AND "quantityReserved" >= ${quantity}
      RETURNING *
    `;
    return updated ?? null;
  }

  async setStock(
    tx: Prisma.TransactionClient,
    productId: string,
    quantityAvailable: number,
  ): Promise<Inventory | null> {
    // Read-then-conditional-write, both inside the caller's transaction:
    // the WHERE version clause is the CAS guard against a concurrent
    // checkout/restore committing between the read and this write, same
    // principle as reserveStock's quantityAvailable guard.
    const current = await tx.inventory.findUniqueOrThrow({
      where: { productId },
    });
    const [updated] = await tx.inventory.updateManyAndReturn({
      where: { productId, version: current.version },
      data: { quantityAvailable, version: { increment: 1 } },
    });
    return updated ?? null;
  }
}
