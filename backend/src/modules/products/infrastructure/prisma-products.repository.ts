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

  // A sale consumes units outright: quantityAvailable drops and
  // quantityReserved is left alone. Reserved means "held but NOT yet
  // sold" (a live auction lot) — incrementing it here too would charge
  // the same unit against sellable stock twice, since every reader
  // (search-sync's inStock, BiddingService's lot validation) computes
  // what's sellable as quantityAvailable - quantityReserved.
  //
  // `quantityAvailable - quantityReserved >= quantity` in the WHERE IS
  // the concurrency guard: two concurrent transactions decrementing the
  // same row serialize at the database (the second re-evaluates this
  // condition against the first's committed result), so this can never
  // oversell — and it can't sell units an auction is holding either.
  // Raw SQL because that comparison is column-to-column, which Prisma's
  // query API can't express; RETURNING keeps it to one round trip, which
  // matters against a REMOTE database (see the class comment).
  async decrementStock(
    tx: Prisma.TransactionClient,
    productId: string,
    quantity: number,
  ): Promise<Inventory | null> {
    const [updated] = await tx.$queryRaw<Inventory[]>`
      UPDATE "Inventory"
      SET "quantityAvailable" = "quantityAvailable" - ${quantity},
          "version" = "version" + 1,
          "updatedAt" = NOW()
      WHERE "productId" = ${productId}
        AND "quantityAvailable" - "quantityReserved" >= ${quantity}
      RETURNING *
    `;
    return updated ?? null;
  }

  // Puts units on hold WITHOUT consuming them — an auction lot stays
  // physically in stock (and keeps showing a real stock count) right up
  // until the winner actually checks out; it just can't be sold out from
  // under the auction in the meantime.
  //
  // Guarded on the real stock count ALONE, deliberately not on
  // `quantityAvailable - quantityReserved` the way decrementStock is:
  // quantityReserved is a denormalized cache of auction claims, and
  // gating a new hold on it would let a drifted counter veto an auction
  // the seller's actual stock and actual auctions both permit. How many
  // units are genuinely still claimed is decided from the auction rows
  // themselves, in the same transaction — see BiddingService.createAuction.
  async reserveStock(
    tx: Prisma.TransactionClient,
    productId: string,
    quantity: number,
  ): Promise<Inventory | null> {
    const [updated] = await tx.inventory.updateManyAndReturn({
      where: { productId, quantityAvailable: { gte: quantity } },
      data: {
        quantityReserved: { increment: quantity },
        version: { increment: 1 },
      },
    });
    return updated ?? null;
  }

  // Frees a hold placed by reserveStock — the auction ended with no
  // winner, the winner let their checkout window lapse, or the hold is
  // converting into an actual sale (in which case the caller decrements
  // stock in the same transaction). Only ever called behind a guarded
  // status transition, so it can't double-release.
  releaseReservation(
    tx: Prisma.TransactionClient,
    productId: string,
    quantity: number,
  ): Promise<Inventory> {
    return tx.inventory.update({
      where: { productId },
      data: {
        quantityReserved: { decrement: quantity },
        version: { increment: 1 },
      },
    });
  }

  // Mirror image of decrementStock (a cancelled order putting units
  // back), so it touches quantityAvailable only.
  restoreStock(
    tx: Prisma.TransactionClient,
    productId: string,
    quantity: number,
  ): Promise<Inventory> {
    return tx.inventory.update({
      where: { productId },
      data: {
        quantityAvailable: { increment: quantity },
        version: { increment: 1 },
      },
    });
  }

  async setStock(
    tx: Prisma.TransactionClient,
    productId: string,
    quantityAvailable: number,
  ): Promise<Inventory | null> {
    // Read-then-conditional-write, both inside the caller's transaction:
    // the WHERE version clause is the CAS guard against a concurrent
    // checkout/restore committing between the read and this write, same
    // principle as decrementStock's WHERE quantityAvailable >= quantity.
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
