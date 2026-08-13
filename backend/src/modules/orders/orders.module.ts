import { Module } from '@nestjs/common';
import { BullModule } from '@nestjs/bullmq';
import { OutboxModule } from '../../infrastructure/outbox/outbox.module';
import { IdempotencyModule } from '../../infrastructure/idempotency/idempotency.module';
import { QueueName } from '../../infrastructure/queue/queue.constants';
import { CartModule } from '../cart/cart.module';
import { ProductsModule } from '../products/products.module';
import { SellersModule } from '../sellers/sellers.module';
import { BiddingModule } from '../bidding/bidding.module';
import { OrdersController } from './orders.controller';
import { OrdersService } from './orders.service';
import { OrdersRepository } from './domain/orders.repository';
import { PrismaOrdersRepository } from './infrastructure/prisma-orders.repository';
import { OrderProcessingConsumer } from './consumers/order-processing.consumer';

@Module({
  imports: [
    BullModule.registerQueue({ name: QueueName.ORDER_PROCESSING }),
    CartModule,
    ProductsModule,
    SellersModule,
    BiddingModule,
    OutboxModule,
    IdempotencyModule,
  ],
  controllers: [OrdersController],
  providers: [
    OrdersService,
    { provide: OrdersRepository, useClass: PrismaOrdersRepository },
    OrderProcessingConsumer,
  ],
  exports: [OrdersService],
})
export class OrdersModule {}
