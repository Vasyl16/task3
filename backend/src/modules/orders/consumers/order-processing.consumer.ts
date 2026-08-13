import { Injectable, Logger } from '@nestjs/common';
import { OnWorkerEvent, Processor } from '@nestjs/bullmq';
import type { Job } from 'bullmq';
import type { DomainEventJob } from '../../../infrastructure/queue/domain-event-job.interface';
import { DomainEventConsumer } from '../../../infrastructure/queue/domain-event.consumer';
import { CorrelationIdService } from '../../../core/correlation-id/correlation-id.service';
import { MetricsService } from '../../../infrastructure/metrics/metrics.service';
import { QueueName } from '../../../infrastructure/queue/queue.constants';
import { EventIdempotencyService } from '../../../infrastructure/idempotency/event-idempotency.service';
import { SELLER_ORDER_CREATED_EVENT } from '../domain/events/seller-order-created.event';
import { OrdersService } from '../orders.service';

export const ORDER_PROCESSING_CONSUMER_NAME = 'order-processing';

// The async half of "SellerOrder processing must happen asynchronously
// through BullMQ": a freshly-checked-out SellerOrder starts at NEW; this
// consumer auto-advances it to PROCESSING once the SellerOrderCreated
// event (recorded in the same transaction as checkout — see
// OrdersService.executeOrderTransaction) has been reliably delivered.
// Idempotent two ways: EventIdempotencyService's ProcessedEvent guard,
// AND OrdersService.autoAdvanceToProcessing's own conditional
// (status-guarded) update — either alone would be enough, but the
// second is what actually makes redelivery cheap/harmless without a DB
// round-trip failing loudly.
@Injectable()
@Processor(QueueName.ORDER_PROCESSING)
export class OrderProcessingConsumer extends DomainEventConsumer {
  private readonly logger = new Logger(OrderProcessingConsumer.name);

  constructor(
    private readonly ordersService: OrdersService,
    private readonly eventIdempotency: EventIdempotencyService,
    correlationIdService: CorrelationIdService,
    metricsService: MetricsService,
  ) {
    super(correlationIdService, metricsService, QueueName.ORDER_PROCESSING);
  }

  protected async handleEvent(job: Job<DomainEventJob>): Promise<void> {
    const { eventId, eventType, payload } = job.data;

    if (eventType !== SELLER_ORDER_CREATED_EVENT) {
      return;
    }

    const result = await this.eventIdempotency.run(
      ORDER_PROCESSING_CONSUMER_NAME,
      eventId,
      (tx) =>
        this.ordersService.autoAdvanceToProcessing(
          tx,
          payload.sellerOrderId as string,
        ),
    );

    this.logger.log({
      event: 'order_processing.event_processed',
      eventId,
      eventType,
      entityType: 'SellerOrder',
      entityId: payload.sellerOrderId as string,
      result,
    });
  }

  // Fires outside the job's ALS context, so correlationId is read from
  // the payload and passed explicitly.
  @OnWorkerEvent('failed')
  onFailed(job: Job<DomainEventJob> | undefined, err: Error): void {
    this.logger.error({
      event: 'order_processing.job_failed',
      eventId: job?.data.eventId,
      correlationId: job?.data.correlationId,
      jobAttempt: job?.attemptsMade,
      error: err,
    });
  }
}
