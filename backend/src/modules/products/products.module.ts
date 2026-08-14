import { Module } from '@nestjs/common';
import { OutboxModule } from '../../infrastructure/outbox/outbox.module';
import { CategoriesModule } from '../categories/categories.module';
import { ReviewsModule } from '../reviews/reviews.module';
import { SellersModule } from '../sellers/sellers.module';
import { ProductsController } from './products.controller';
import { ProductsService } from './products.service';
import { ProductsRepository } from './domain/products.repository';
import { PrismaProductsRepository } from './infrastructure/prisma-products.repository';

@Module({
  imports: [SellersModule, CategoriesModule, OutboxModule, ReviewsModule],
  controllers: [ProductsController],
  providers: [
    ProductsService,
    { provide: ProductsRepository, useClass: PrismaProductsRepository },
  ],
  exports: [ProductsService],
})
export class ProductsModule {}
