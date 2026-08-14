import { Module } from '@nestjs/common';
import { OrdersModule } from '../orders/orders.module';
import { SellersModule } from '../sellers/sellers.module';
import { DisputesController } from './disputes.controller';
import { DisputesService } from './disputes.service';
import { DisputesRepository } from './domain/disputes.repository';
import { PrismaDisputesRepository } from './infrastructure/prisma-disputes.repository';

@Module({
  imports: [OrdersModule, SellersModule],
  controllers: [DisputesController],
  providers: [
    DisputesService,
    { provide: DisputesRepository, useClass: PrismaDisputesRepository },
  ],
  exports: [DisputesService],
})
export class DisputesModule {}
