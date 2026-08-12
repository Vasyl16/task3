import { Module } from '@nestjs/common';
import { OrdersModule } from '../orders/orders.module';
import { SellersModule } from '../sellers/sellers.module';
import { PaymentsLedgerController } from './payments-ledger.controller';
import { PaymentsLedgerService } from './payments-ledger.service';
import { PaymentsLedgerRepository } from './domain/payments-ledger.repository';
import { PrismaPaymentsLedgerRepository } from './infrastructure/prisma-payments-ledger.repository';

@Module({
  imports: [OrdersModule, SellersModule],
  controllers: [PaymentsLedgerController],
  providers: [
    PaymentsLedgerService,
    {
      provide: PaymentsLedgerRepository,
      useClass: PrismaPaymentsLedgerRepository,
    },
  ],
  exports: [PaymentsLedgerService],
})
export class PaymentsLedgerModule {}
