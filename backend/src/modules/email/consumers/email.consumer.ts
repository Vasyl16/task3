import { Injectable, Logger } from '@nestjs/common';
import { OnWorkerEvent, Processor } from '@nestjs/bullmq';
import type { Job } from 'bullmq';
import type { DomainEventJob } from '../../../infrastructure/queue/domain-event-job.interface';
import { DomainEventConsumer } from '../../../infrastructure/queue/domain-event.consumer';
import { CorrelationIdService } from '../../../core/correlation-id/correlation-id.service';
import { MetricsService } from '../../../infrastructure/metrics/metrics.service';
import { QueueName } from '../../../infrastructure/queue/queue.constants';
import { EventIdempotencyService } from '../../../infrastructure/idempotency/event-idempotency.service';
import { ORDER_PLACED_EVENT } from '../../orders/domain/events/order-placed.event';
import { SELLER_ORDER_CREATED_EVENT } from '../../orders/domain/events/seller-order-created.event';
import { SELLER_ORDER_STATUS_CHANGED_EVENT } from '../../orders/domain/events/seller-order-status-changed.event';
import { AUCTION_ENDED_EVENT } from '../../bidding/domain/events/auction-ended.event';
import { EmailService } from '../email.service';
import type { NotifiableSellerOrderStatus } from '../templates';

export const EMAIL_CONSUMER_NAME = 'email';

// Mirrors NotificationsConsumer's identical filter: NEW is the creation
// event itself, PROCESSING is usually the automatic system advance
// (OrdersService.autoAdvanceToProcessing), not a seller decision.
const NOTIFIABLE_STATUSES = new Set<string>([
  'SHIPPED',
  'COMPLETED',
  'CANCELLED',
]);

// Standalone, like SearchSyncConsumer/NotificationsConsumer: no
// OrdersModule import. OrderPlacedEvent's payload only carries ids (see
// order-placed.event.ts) — buyer name/email and the order total are
// re-read from Postgres here, via the idempotency transaction's own
// client, the same way SearchSyncConsumer reads Product without
// importing ProductsModule.
//
// A Resend rejection (EmailService catches and logs it, never throws)
// still lets the ProcessedEvent row commit — a bad delivery isn't
// something a BullMQ retry would fix, and email is a best-effort
// notification, not a source of truth (same rule as Meilisearch/
// WebSocket — see backend.md). A thrown error (Resend unreachable, or
// the Order row genuinely missing) rolls the transaction back and
// rethrows so BullMQ retries the job, same as SearchSyncConsumer's
// Meilisearch-down case.
@Injectable()
@Processor(QueueName.EMAIL)
export class EmailConsumer extends DomainEventConsumer {
  private readonly logger = new Logger(EmailConsumer.name);

  constructor(
    private readonly emailService: EmailService,
    private readonly eventIdempotency: EventIdempotencyService,
    correlationIdService: CorrelationIdService,
    metricsService: MetricsService,
  ) {
    super(correlationIdService, metricsService, QueueName.EMAIL);
  }

  protected async handleEvent(job: Job<DomainEventJob>): Promise<void> {
    const { eventType } = job.data;

    switch (eventType) {
      case ORDER_PLACED_EVENT:
        return this.handleOrderPlaced(job.data);
      case SELLER_ORDER_CREATED_EVENT:
        return this.handleSellerOrderCreated(job.data);
      case SELLER_ORDER_STATUS_CHANGED_EVENT:
        return this.handleSellerOrderStatusChanged(job.data);
      case AUCTION_ENDED_EVENT:
        return this.handleAuctionEnded(job.data);
      default:
        return;
    }
  }

  private async handleOrderPlaced(jobData: DomainEventJob): Promise<void> {
    const { eventId, eventType, payload } = jobData;
    const orderId = payload.orderId as string;

    const result = await this.eventIdempotency.run(
      EMAIL_CONSUMER_NAME,
      eventId,
      async (tx) => {
        const order = await tx.order.findUniqueOrThrow({
          where: { id: orderId },
          include: { buyer: true },
        });

        await this.emailService.sendPaymentReceipt(order.buyer.email, {
          orderId: order.id,
          buyerName: order.buyer.name,
          totalAmount: order.totalAmount.toString(),
          placedAt: order.placedAt,
        });
      },
    );

    this.logger.log({
      event: 'email.event_processed',
      eventId,
      eventType,
      entityType: 'Order',
      entityId: orderId,
      result,
    });
  }

  // The seller-facing counterpart to handleOrderPlaced's buyer receipt —
  // fires once per SellerOrder (a multi-vendor checkout produces one
  // SellerOrderCreated per seller, each its own email), not once per
  // Order.
  private async handleSellerOrderCreated(
    jobData: DomainEventJob,
  ): Promise<void> {
    const { eventId, eventType, payload } = jobData;
    const sellerOrderId = payload.sellerOrderId as string;
    const sellerUserId = payload.sellerUserId as string;

    const result = await this.eventIdempotency.run(
      EMAIL_CONSUMER_NAME,
      eventId,
      async (tx) => {
        const [sellerOrder, sellerUser] = await Promise.all([
          tx.sellerOrder.findUniqueOrThrow({
            where: { id: sellerOrderId },
            include: { order: { include: { buyer: true } } },
          }),
          tx.user.findUniqueOrThrow({ where: { id: sellerUserId } }),
        ]);

        await this.emailService.sendNewOrderReceived(sellerUser.email, {
          orderId: sellerOrder.orderId,
          sellerOrderId: sellerOrder.id,
          sellerName: sellerUser.name,
          buyerName: sellerOrder.order.buyer.name,
          subtotal: sellerOrder.subtotal.toString(),
        });
      },
    );

    this.logger.log({
      event: 'email.event_processed',
      eventId,
      eventType,
      entityType: 'SellerOrder',
      entityId: sellerOrderId,
      result,
    });
  }

  // Only SHIPPED/COMPLETED/CANCELLED are mailed — NEW is the creation
  // event (already covered by handleSellerOrderCreated) and PROCESSING
  // is usually the automatic system advance, not a seller decision.
  // Ignored transitions are never run through eventIdempotency — there's
  // nothing to dedupe, same as an eventType this consumer doesn't handle
  // at all.
  private async handleSellerOrderStatusChanged(
    jobData: DomainEventJob,
  ): Promise<void> {
    const { eventId, eventType, payload } = jobData;
    const status = payload.status as string;
    if (!NOTIFIABLE_STATUSES.has(status)) {
      return;
    }
    const sellerOrderId = payload.sellerOrderId as string;

    const result = await this.eventIdempotency.run(
      EMAIL_CONSUMER_NAME,
      eventId,
      async (tx) => {
        const sellerOrder = await tx.sellerOrder.findUniqueOrThrow({
          where: { id: sellerOrderId },
          include: { order: { include: { buyer: true } }, seller: true },
        });

        await this.emailService.sendOrderStatusUpdate(
          sellerOrder.order.buyer.email,
          {
            orderId: sellerOrder.orderId,
            sellerOrderId: sellerOrder.id,
            buyerName: sellerOrder.order.buyer.name,
            sellerName: sellerOrder.seller.businessName,
            status: status as NotifiableSellerOrderStatus,
          },
        );
      },
    );

    this.logger.log({
      event: 'email.event_processed',
      eventId,
      eventType,
      entityType: 'SellerOrder',
      entityId: sellerOrderId,
      result,
    });
  }

  // No email when there's no winner (no bids placed) — winningBidderId is
  // null in that case (see AuctionEndedEvent).
  private async handleAuctionEnded(jobData: DomainEventJob): Promise<void> {
    const { eventId, eventType, payload } = jobData;
    const winningBidderId = payload.winningBidderId as string | null;
    if (!winningBidderId) {
      return;
    }
    const auctionId = payload.auctionId as string;

    const result = await this.eventIdempotency.run(
      EMAIL_CONSUMER_NAME,
      eventId,
      async (tx) => {
        const [auction, winner] = await Promise.all([
          tx.auction.findUniqueOrThrow({
            where: { id: auctionId },
            include: { product: true },
          }),
          tx.user.findUniqueOrThrow({ where: { id: winningBidderId } }),
        ]);

        if (!auction.currentHighestBid) {
          return; // defensive — a winner always has a highest bid
        }

        await this.emailService.sendAuctionWon(winner.email, {
          auctionId: auction.id,
          productName: auction.product.name,
          winnerName: winner.name,
          winningAmount: auction.currentHighestBid.toString(),
          checkoutDeadline: auction.checkoutDeadline,
        });
      },
    );

    this.logger.log({
      event: 'email.event_processed',
      eventId,
      eventType,
      entityType: 'Auction',
      entityId: auctionId,
      result,
    });
  }

  // Fires outside the job's ALS context, so correlationId is read from
  // the payload and passed explicitly.
  @OnWorkerEvent('failed')
  onFailed(job: Job<DomainEventJob> | undefined, err: Error): void {
    this.logger.error({
      event: 'email.job_failed',
      eventId: job?.data.eventId,
      correlationId: job?.data.correlationId,
      jobAttempt: job?.attemptsMade,
      error: err,
    });
  }
}
