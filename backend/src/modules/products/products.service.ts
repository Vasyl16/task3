import { Injectable, NotFoundException } from '@nestjs/common';
import type { Product } from '@prisma/client';
import { randomUUID } from 'node:crypto';
import { CorrelationIdService } from '../../core/correlation-id/correlation-id.service';
import { PrismaService } from '../../infrastructure/prisma/prisma.service';
import { OutboxService } from '../../infrastructure/outbox/outbox.service';
import { CategoriesService } from '../categories/categories.service';
import { SellersService } from '../sellers/sellers.service';
import { ProductsRepository } from './domain/products.repository';
import { PRODUCT_CREATED_EVENT } from './domain/events/product-created.event';
import { CreateProductDto } from './dto/create-product.dto';
import { UpdateProductDto } from './dto/update-product.dto';

@Injectable()
export class ProductsService {
  constructor(
    private readonly productsRepository: ProductsRepository,
    private readonly sellersService: SellersService,
    private readonly categoriesService: CategoriesService,
    private readonly outboxService: OutboxService,
    private readonly correlationIdService: CorrelationIdService,
    // Used only to open the transaction boundary below — every actual
    // read/write still goes through ProductsRepository, keeping Prisma
    // details out of the rest of the service.
    private readonly prisma: PrismaService,
  ) {}

  findAll(filter?: {
    categoryId?: string;
    sellerId?: string;
  }): Promise<Product[]> {
    return this.productsRepository.findAll(filter);
  }

  async findById(id: string): Promise<Product> {
    const product = await this.productsRepository.findById(id);
    if (!product) {
      throw new NotFoundException(`Product ${id} not found`);
    }
    return product;
  }

  // Reference implementation of the strong-consistency + outbox pattern:
  // Product + Inventory + OutboxEvent all commit in one transaction, or
  // none do. The (future) search-sync consumer picks up ProductCreated
  // asynchronously — Products never calls Meilisearch directly.
  async create(dto: CreateProductDto): Promise<Product> {
    await this.sellersService.findById(dto.sellerId);
    await this.categoriesService.findById(dto.categoryId);
    const correlationId = this.correlationIdService.getId() ?? randomUUID();

    return this.prisma.$transaction(async (tx) => {
      const product = await this.productsRepository.createWithInventory(
        tx,
        dto,
      );
      await this.outboxService.record(tx, {
        aggregateType: 'Product',
        aggregateId: product.id,
        eventType: PRODUCT_CREATED_EVENT,
        payload: {
          productId: product.id,
          sellerId: product.sellerId,
          categoryId: product.categoryId,
          name: product.name,
        },
        correlationId,
      });
      return product;
    });
  }

  async update(id: string, dto: UpdateProductDto): Promise<Product> {
    await this.findById(id); // 404s if missing
    // NOTE: not yet wrapped in the outbox pattern like create() above —
    // do that (ProductUpdated event) before this reaches production,
    // since search-sync also needs to react to updates.
    return this.productsRepository.update(id, dto);
  }
}
