import { Module } from '@nestjs/common';
import { OutboxModule } from '../../infrastructure/outbox/outbox.module';
import { CartModule } from '../cart/cart.module';
import { ProductsModule } from '../products/products.module';
import { SellersModule } from '../sellers/sellers.module';
import { OrdersController } from './orders.controller';
import { OrdersService } from './orders.service';
import { OrdersRepository } from './domain/orders.repository';
import { PrismaOrdersRepository } from './infrastructure/prisma-orders.repository';

@Module({
  imports: [CartModule, ProductsModule, SellersModule, OutboxModule],
  controllers: [OrdersController],
  providers: [
    OrdersService,
    { provide: OrdersRepository, useClass: PrismaOrdersRepository },
  ],
  exports: [OrdersService],
})
export class OrdersModule {}
