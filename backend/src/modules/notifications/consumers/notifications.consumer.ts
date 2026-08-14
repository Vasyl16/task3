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
import { SELLER_ORDER_STATUS_CHANGED_EVENT } from '../../orders/domain/events/seller-order-status-changed.event';
import { AUCTION_ENDED_EVENT } from '../../bidding/domain/events/auction-ended.event';
import { REFUND_PROCESSED_EVENT } from '../../payments-ledger/domain/events/refund-processed.event';
import { REFUND_FAILED_EVENT } from '../../payments-ledger/domain/events/refund-failed.event';
import { NotificationsService } from '../notifications.service';

export const NOTIFICATIONS_CONSUMER_NAME = 'notifications';

// The subset of SellerOrderStatus a buyer actually wants to hear about —
// NEW is the creation event itself (nothing has "changed" yet) and
// PROCESSING is usually the automatic system advance
// (OrdersService.autoAdvanceToProcessing), not a seller decision. Mirrors
// EmailConsumer's identical filter.
const NOTIFIABLE_STATUSES = new Set(['SHIPPED', 'COMPLETED', 'CANCELLED']);

function statusChangeCopy(
  status: string,
  sellerName: string,
): { title: string; body: string } {
  switch (status) {
    case 'SHIPPED':
      return {
        title: 'Your order has shipped',
        body: `${sellerName} shipped your order. It's on its way.`,
      };
    case 'COMPLETED':
      return {
        title: 'Order completed',
        body: `Your order from ${sellerName} is complete.`,
      };
    default:
      return {
        title: 'Order cancelled',
        body: `${sellerName} cancelled your order.`,
      };
  }
}

// Deliberately standalone: takes sellerUserId (or, for AuctionEnded,
// winningBidderId — already a User id, no SellerProfile involved)
// directly from the event payload rather than resolving other entities
// itself, so this module imports no other business module (see the
// backend-architecture skill — search/analytics/notifications are
// standalone by design, kept decoupled purely through outbox events).
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
    const { eventType } = job.data;

    switch (eventType) {
      case SELLER_ORDER_CREATED_EVENT:
        return this.handleSellerOrderCreated(job.data);
      case SELLER_ORDER_STATUS_CHANGED_EVENT:
        return this.handleSellerOrderStatusChanged(job.data);
      case AUCTION_ENDED_EVENT:
        return this.handleAuctionEnded(job.data);
      case REFUND_PROCESSED_EVENT:
        return this.handleRefundProcessed(job.data);
      case REFUND_FAILED_EVENT:
        return this.handleRefundFailed(job.data);
      default:
        return;
    }
  }

  private async handleSellerOrderCreated(
    jobData: DomainEventJob,
  ): Promise<void> {
    const { eventId, eventType, payload } = jobData;

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

  private async handleSellerOrderStatusChanged(
    jobData: DomainEventJob,
  ): Promise<void> {
    const { eventId, eventType, payload } = jobData;
    const status = payload.status as string;
    if (!NOTIFIABLE_STATUSES.has(status)) {
      return;
    }
    const buyerId = payload.buyerId as string;
    const sellerOrderId = payload.sellerOrderId as string;

    const result = await this.eventIdempotency.run(
      NOTIFICATIONS_CONSUMER_NAME,
      eventId,
      async (tx) => {
        const sellerOrder = await tx.sellerOrder.findUniqueOrThrow({
          where: { id: sellerOrderId },
          include: { seller: true },
        });
        const { title, body } = statusChangeCopy(
          status,
          sellerOrder.seller.businessName,
        );

        await this.notificationsService.create(tx, {
          userId: buyerId,
          type: 'SELLER_ORDER_STATUS_CHANGED',
          title,
          body,
          data: {
            sellerOrderId: sellerOrder.id,
            orderId: sellerOrder.orderId,
            status,
          },
        });
      },
    );

    this.logger.log({
      event: 'notifications.event_processed',
      eventId,
      eventType,
      userId: buyerId,
      entityType: 'SellerOrder',
      entityId: sellerOrderId,
      result,
    });
  }

  // No notification when there's no winner (no bids placed).
  private async handleAuctionEnded(jobData: DomainEventJob): Promise<void> {
    const { eventId, eventType, payload } = jobData;
    const winningBidderId = payload.winningBidderId as string | null;
    if (!winningBidderId) {
      return;
    }
    const auctionId = payload.auctionId as string;

    const result = await this.eventIdempotency.run(
      NOTIFICATIONS_CONSUMER_NAME,
      eventId,
      async (tx) => {
        const auction = await tx.auction.findUniqueOrThrow({
          where: { id: auctionId },
          include: { product: true },
        });

        await this.notificationsService.create(tx, {
          userId: winningBidderId,
          type: 'AUCTION_WON',
          title: 'You won an auction!',
          body: `Your bid won the auction for "${auction.product.name}". Check out from My Auctions to claim it.`,
          data: {
            auctionId: auction.id,
            productId: auction.productId,
          },
        });
      },
    );

    this.logger.log({
      event: 'notifications.event_processed',
      eventId,
      eventType,
      userId: winningBidderId,
      entityType: 'Auction',
      entityId: auctionId,
      result,
    });
  }

  // The refund saga's two termini (see RefundConsumer). Both notify the
  // buyer, because both are facts about their money — including, and
  // especially, the failure: a refund that silently never arrives is
  // exactly the outcome the escalation path exists to prevent.
  private async handleRefundProcessed(jobData: DomainEventJob): Promise<void> {
    const { eventId, eventType, payload } = jobData;
    const buyerId = payload.buyerId as string;

    const result = await this.eventIdempotency.run(
      NOTIFICATIONS_CONSUMER_NAME,
      eventId,
      async (tx) => {
        await this.notificationsService.create(tx, {
          userId: buyerId,
          type: 'REFUND_PROCESSED',
          title: 'Refund issued',
          body: `Your refund of $${payload.amount as string} for the cancelled order is on its way back to you.`,
          data: {
            refundId: payload.refundId,
            sellerOrderId: payload.sellerOrderId,
          },
        });
      },
    );

    this.logger.log({
      event: 'notifications.event_processed',
      eventId,
      eventType,
      userId: buyerId,
      entityType: 'Refund',
      entityId: payload.refundId as string,
      result,
    });
  }

  private async handleRefundFailed(jobData: DomainEventJob): Promise<void> {
    const { eventId, eventType, payload } = jobData;
    const buyerId = payload.buyerId as string;

    const result = await this.eventIdempotency.run(
      NOTIFICATIONS_CONSUMER_NAME,
      eventId,
      async (tx) => {
        await this.notificationsService.create(tx, {
          userId: buyerId,
          type: 'REFUND_FAILED',
          title: 'We could not issue your refund',
          body: `Your refund of $${payload.amount as string} could not be completed automatically. Our team has been alerted and will resolve it.`,
          data: {
            refundId: payload.refundId,
            sellerOrderId: payload.sellerOrderId,
            failureReason: payload.failureReason,
          },
        });
      },
    );

    // Logged at error level on purpose: this is the one saga outcome
    // that needs a human, so it should surface in Grafana/Loki next to
    // real failures rather than blend into the info stream.
    this.logger.error({
      event: 'notifications.refund_failed_notified',
      eventId,
      eventType,
      userId: buyerId,
      entityType: 'Refund',
      entityId: payload.refundId as string,
      attempts: payload.attempts,
      failureReason: payload.failureReason,
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
