import { Injectable } from '@nestjs/common';
import { ProductStatus, type Prisma, type Product } from '@prisma/client';
import { PrismaService } from '../../../infrastructure/prisma/prisma.service';
import {
  CreateProductWithInventoryInput,
  ProductsRepository,
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
    id: string,
    data: Partial<{ name: string; description: string; basePrice: number }>,
  ): Promise<Product> {
    return this.prisma.product.update({ where: { id }, data });
  }

  archive(id: string): Promise<Product> {
    return this.prisma.product.update({
      where: { id },
      data: { status: ProductStatus.ARCHIVED },
    });
  }
}
