import { Module } from '@nestjs/common';
import { BullModule } from '@nestjs/bullmq';
import { QueueName } from '../../infrastructure/queue/queue.constants';
import { OutboxModule } from '../../infrastructure/outbox/outbox.module';
import { IdempotencyModule } from '../../infrastructure/idempotency/idempotency.module';
import { OrdersModule } from '../orders/orders.module';
import { SellersModule } from '../sellers/sellers.module';
import { PaymentsLedgerController } from './payments-ledger.controller';
import { PaymentsLedgerService } from './payments-ledger.service';
import { PaymentsLedgerRepository } from './domain/payments-ledger.repository';
import { PrismaPaymentsLedgerRepository } from './infrastructure/prisma-payments-ledger.repository';
import { MockPaymentGatewayService } from './infrastructure/mock-payment-gateway.service';
import { RefundConsumer } from './consumers/refund.consumer';

// Depends on OrdersModule, never the reverse: the cancellation that
// starts the refund saga is delivered as an outbox event, so orders
// stays unaware that refunds exist at all. See RefundConsumer.
@Module({
  imports: [
    BullModule.registerQueue({ name: QueueName.PAYMENTS }),
    OrdersModule,
    SellersModule,
    OutboxModule,
    IdempotencyModule,
  ],
  controllers: [PaymentsLedgerController],
  providers: [
    PaymentsLedgerService,
    MockPaymentGatewayService,
    RefundConsumer,
    {
      provide: PaymentsLedgerRepository,
      useClass: PrismaPaymentsLedgerRepository,
    },
  ],
  exports: [PaymentsLedgerService],
})
export class PaymentsLedgerModule {}
