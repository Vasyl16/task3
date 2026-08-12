import { Module } from '@nestjs/common';
import { OutboxModule } from '../../infrastructure/outbox/outbox.module';
import { ProductsModule } from '../products/products.module';
import { SellersModule } from '../sellers/sellers.module';
import { BiddingController } from './bidding.controller';
import { BiddingService } from './bidding.service';
import { BiddingRepository } from './domain/bidding.repository';
import { PrismaBiddingRepository } from './infrastructure/prisma-bidding.repository';

@Module({
  imports: [ProductsModule, SellersModule, OutboxModule],
  controllers: [BiddingController],
  providers: [
    BiddingService,
    { provide: BiddingRepository, useClass: PrismaBiddingRepository },
  ],
  exports: [BiddingService],
})
export class BiddingModule {}
