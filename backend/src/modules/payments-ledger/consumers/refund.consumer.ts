import { Injectable, Logger } from '@nestjs/common';
import { OnWorkerEvent, Processor } from '@nestjs/bullmq';
import { RefundStatus, SellerOrderStatus } from '@prisma/client';
import type { Job } from 'bullmq';
import type { DomainEventJob } from '../../../infrastructure/queue/domain-event-job.interface';
import { DomainEventConsumer } from '../../../infrastructure/queue/domain-event.consumer';
import { CorrelationIdService } from '../../../core/correlation-id/correlation-id.service';
import { MetricsService } from '../../../infrastructure/metrics/metrics.service';
import { QueueName } from '../../../infrastructure/queue/queue.constants';
import { EventIdempotencyService } from '../../../infrastructure/idempotency/event-idempotency.service';
import { SELLER_ORDER_STATUS_CHANGED_EVENT } from '../../orders/domain/events/seller-order-status-changed.event';
import { OrdersService } from '../../orders/orders.service';
import { PaymentsLedgerService } from '../payments-ledger.service';
import {
  MockPaymentGatewayService,
  PaymentGatewayError,
} from '../infrastructure/mock-payment-gateway.service';

export const REFUND_CONSUMER_NAME = 'refund';

// ============================ The refund saga ============================
//
// Cancelling a SellerOrder has to undo four things: the order status, the
// stock, the seller's ledger, and the buyer's money. The first three
// share one database, so OrdersService.updateSellerOrderStatus does them
// in a single ACID transaction — that is strictly better than a saga and
// deliberately stays that way. Only the fourth leaves the database, and
// a payment provider cannot be rolled back by COMMIT/ROLLBACK. That one
// hop is this saga.
//
// It runs as three separately-committed steps, because the gateway call
// in the middle must NOT sit inside a transaction (it would hold the
// transaction open across a network call, and a rollback afterwards
// would leave money moved with no record of it — the classic dual-write
// trap):
//
//   1. Open a Refund (REQUESTED), committed with the ProcessedEvent
//      marker so "we saw this cancellation" and "a refund exists" are
//      one atomic fact.
//   2. Call the gateway. Outside any transaction. May fail; that is
//      normal, and BullMQ retries the whole handler.
//   3. Settle it: REQUESTED -> PROCESSED, or after the last retry
//      REQUESTED -> FAILED. Guarded transitions, so a duplicate
//      delivery can't settle the same refund twice.
//
// Crash recovery is driven by the REFUND ROW's state, never by the
// event marker: if the process dies between 2 and 3, redelivery finds
// the marker already written (step 1 skipped) but the refund still
// REQUESTED, and carries on from step 2. Replaying the gateway call is
// safe because it is keyed by refund id — see MockPaymentGatewayService.
@Injectable()
@Processor(QueueName.PAYMENTS)
export class RefundConsumer extends DomainEventConsumer {
  private readonly logger = new Logger(RefundConsumer.name);

  constructor(
    private readonly paymentsLedgerService: PaymentsLedgerService,
    private readonly ordersService: OrdersService,
    private readonly gateway: MockPaymentGatewayService,
    private readonly eventIdempotency: EventIdempotencyService,
    correlationIdService: CorrelationIdService,
    metricsService: MetricsService,
  ) {
    super(correlationIdService, metricsService, QueueName.PAYMENTS);
  }

  protected async handleEvent(job: Job<DomainEventJob>): Promise<void> {
    const { eventId, eventType, payload } = job.data;

    if (eventType !== SELLER_ORDER_STATUS_CHANGED_EVENT) {
      return;
    }
    // Every other status reaches this queue too (one event, several
    // reactions) — only a cancellation owes anyone money back.
    if (payload.status !== SellerOrderStatus.CANCELLED) {
      return;
    }

    const sellerOrderId = payload.sellerOrderId as string;
    const buyerId = payload.buyerId as string;
    const sellerOrder =
      await this.ordersService.findSellerOrderById(sellerOrderId);

    // --- Step 1: open the refund (idempotent) ---
    let refundId: string | undefined;
    const opened = await this.eventIdempotency.run(
      REFUND_CONSUMER_NAME,
      eventId,
      async (tx) => {
        const refund = await this.paymentsLedgerService.openCancellationRefund(
          tx,
          {
            sellerOrderId,
            // The buyer is made whole for what they paid this seller.
            // Commission is the platform's problem, already reversed in
            // the ledger by the cancellation itself.
            amount: Number(sellerOrder.subtotal),
          },
        );
        refundId = refund.id;
      },
    );

    // A redelivery skips step 1, so recover the refund from the row
    // itself and let steps 2-3 run again if it never settled.
    if (opened === 'skipped') {
      const existing =
        await this.paymentsLedgerService.findRefundForSellerOrder(
          sellerOrderId,
        );
      if (!existing || existing.status !== RefundStatus.REQUESTED) {
        return; // already settled, or never ours to settle
      }
      refundId = existing.id;
    }
    if (!refundId) {
      return;
    }

    const attempt = (job.attemptsMade ?? 0) + 1;
    const isFinalAttempt = attempt >= (job.opts?.attempts ?? 1);

    // --- Step 2: the gateway call, outside any transaction ---
    let gatewayRef: string;
    try {
      const result = await this.gateway.refund({
        idempotencyKey: refundId,
        amount: Number(sellerOrder.subtotal),
        reference: refundId,
      });
      gatewayRef = result.gatewayRef;
    } catch (err) {
      if (!(err instanceof PaymentGatewayError)) {
        throw err; // our bug, not the provider's refusal — fail loudly
      }
      if (!isFinalAttempt) {
        // Hand it back to BullMQ: it owns the retry schedule.
        throw err;
      }
      // --- Step 3b: retries exhausted -> escalate ---
      await this.paymentsLedgerService.failRefund(refundId, {
        failureReason: err.message,
        attempts: attempt,
        buyerId,
      });
      // Deliberately NOT rethrown. The saga has reached a recorded,
      // terminal state and someone has been told; turning it into a
      // permanently-failed job on top of that would add noise without
      // adding information.
      this.logger.error({
        event: 'refund.escalated_to_manual',
        eventId,
        entityType: 'Refund',
        entityId: refundId,
        sellerOrderId,
        attempts: attempt,
        error: err,
      });
      return;
    }

    // --- Step 3a: settle ---
    const settled = await this.paymentsLedgerService.settleRefund(refundId, {
      gatewayRef,
      attempts: attempt,
      buyerId,
    });

    this.logger.log({
      event: 'refund.processed',
      eventId,
      eventType,
      entityType: 'Refund',
      entityId: refundId,
      sellerOrderId,
      userId: buyerId,
      attempts: attempt,
      result: settled ? 'settled' : 'already_settled',
    });
  }

  // Fires outside the job's ALS context, so correlationId is read from
  // the payload and passed explicitly.
  @OnWorkerEvent('failed')
  onFailed(job: Job<DomainEventJob> | undefined, err: Error): void {
    this.logger.error({
      event: 'refund.job_failed',
      eventId: job?.data.eventId,
      correlationId: job?.data.correlationId,
      jobAttempt: job?.attemptsMade,
      error: err,
    });
  }
}
