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
    data: Partial<{ name: string; description: string; basePrice: number }>,
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

  async decrementStock(
    tx: Prisma.TransactionClient,
    productId: string,
    quantity: number,
  ): Promise<Inventory | null> {
    // The WHERE clause's quantityAvailable >= quantity IS the
    // concurrency guard: two concurrent transactions decrementing the
    // same row serialize at the database (the second re-evaluates this
    // condition against the first's committed result), so this can never
    // oversell — no separate read-check-then-write race window exists.
    // version is still bumped for consistency with Inventory's documented
    // invariant, even though it isn't what's providing safety here.
    //
    // updateManyAndReturn (not updateMany + a read-back) so the
    // post-decrement row costs no extra round trip: checkout runs this
    // once per cart line inside a single interactive transaction against
    // a REMOTE database, so each avoided round trip is real latency held
    // against every other checkout contending for these rows.
    const [updated] = await tx.inventory.updateManyAndReturn({
      where: { productId, quantityAvailable: { gte: quantity } },
      data: {
        quantityAvailable: { decrement: quantity },
        quantityReserved: { increment: quantity },
        version: { increment: 1 },
      },
    });
    return updated ?? null;
  }

  restoreStock(
    tx: Prisma.TransactionClient,
    productId: string,
    quantity: number,
  ): Promise<Inventory> {
    return tx.inventory.update({
      where: { productId },
      data: {
        quantityAvailable: { increment: quantity },
        quantityReserved: { decrement: quantity },
        version: { increment: 1 },
      },
    });
  }
}
