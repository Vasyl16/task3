import { Injectable } from '@nestjs/common';
import type { Prisma, Product } from '@prisma/client';
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
}
