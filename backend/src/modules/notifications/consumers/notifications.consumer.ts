import { Injectable, Logger } from '@nestjs/common';
import { OnWorkerEvent, Processor } from '@nestjs/bullmq';
import type { Job } from 'bullmq';
import type { DomainEventJob } from '../../../infrastructure/queue/domain-event-job.interface';
import { DomainEventConsumer } from '../../../infrastructure/queue/domain-event.consumer';
import { CorrelationIdService } from '../../../core/correlation-id/correlation-id.service';
import { MetricsService } from '../../../infrastructure/metrics/metrics.service';
import { QueueName } from '../../../infrastructure/queue/queue.constants';
import { EventIdempotencyService } from '../../../infrastructure/idempotency/event-idempotency.service';
import { SELLER_ORDER_CREATED_EVENT } from '../../orders/domain/events/seller-order-created.event';
import { NotificationsService } from '../notifications.service';

export const NOTIFICATIONS_CONSUMER_NAME = 'notifications';

// Deliberately standalone: takes sellerUserId directly from the event
// payload rather than resolving SellerProfile -> User itself, so this
// module imports no other business module (see the backend-architecture
// skill — search/analytics/notifications are standalone by design, kept
// decoupled purely through outbox events).
@Injectable()
@Processor(QueueName.NOTIFICATIONS)
export class NotificationsConsumer extends DomainEventConsumer {
  private readonly logger = new Logger(NotificationsConsumer.name);

  constructor(
    private readonly notificationsService: NotificationsService,
    private readonly eventIdempotency: EventIdempotencyService,
    correlationIdService: CorrelationIdService,
    metricsService: MetricsService,
  ) {
    super(correlationIdService, metricsService, QueueName.NOTIFICATIONS);
  }

  protected async handleEvent(job: Job<DomainEventJob>): Promise<void> {
    const { eventId, eventType, payload } = job.data;

    if (eventType !== SELLER_ORDER_CREATED_EVENT) {
      return;
    }

    const result = await this.eventIdempotency.run(
      NOTIFICATIONS_CONSUMER_NAME,
      eventId,
      async (tx) => {
        await this.notificationsService.create(tx, {
          userId: payload.sellerUserId as string,
          type: 'SELLER_ORDER_CREATED',
          title: 'New order received',
          body: `You have a new order (SellerOrder ${payload.sellerOrderId as string}).`,
          data: {
            sellerOrderId: payload.sellerOrderId,
            orderId: payload.orderId,
          },
        });
      },
    );

    this.logger.log({
      event: 'notifications.event_processed',
      eventId,
      eventType,
      userId: payload.sellerUserId as string,
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
      event: 'notifications.job_failed',
      eventId: job?.data.eventId,
      correlationId: job?.data.correlationId,
      jobAttempt: job?.attemptsMade,
      error: err,
    });
  }
}
