import { Module } from '@nestjs/common';
import { BullModule } from '@nestjs/bullmq';
import { OutboxModule } from '../../infrastructure/outbox/outbox.module';
import { QueueModule } from '../../infrastructure/queue/queue.module';
import { IdempotencyModule } from '../../infrastructure/idempotency/idempotency.module';
import { QueueName } from '../../infrastructure/queue/queue.constants';
import { ProductsModule } from '../products/products.module';
import { SellersModule } from '../sellers/sellers.module';
import { BiddingController } from './bidding.controller';
import { BiddingService } from './bidding.service';
import { BiddingRepository } from './domain/bidding.repository';
import { PrismaBiddingRepository } from './infrastructure/prisma-bidding.repository';
import { AuctionDeadlineConsumer } from './consumers/auction-deadline.consumer';
import { AuctionDeadlineSweeperService } from './auction-deadline-sweeper.service';

@Module({
  imports: [
    BullModule.registerQueue({ name: QueueName.AUCTION_DEADLINES }),
    ProductsModule,
    SellersModule,
    OutboxModule,
    QueueModule,
    IdempotencyModule,
  ],
  controllers: [BiddingController],
  providers: [
    BiddingService,
    { provide: BiddingRepository, useClass: PrismaBiddingRepository },
    AuctionDeadlineConsumer,
    AuctionDeadlineSweeperService,
  ],
  exports: [BiddingService],
})
export class BiddingModule {}
