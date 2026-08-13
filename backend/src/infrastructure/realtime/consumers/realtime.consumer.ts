import { Injectable, Logger } from '@nestjs/common';
import { OnWorkerEvent, Processor } from '@nestjs/bullmq';
import type { Job } from 'bullmq';
import type { DomainEventJob } from '../../queue/domain-event-job.interface';
import { DomainEventConsumer } from '../../queue/domain-event.consumer';
import { CorrelationIdService } from '../../../core/correlation-id/correlation-id.service';
import { MetricsService } from '../../metrics/metrics.service';
import { QueueName } from '../../queue/queue.constants';
import { INVENTORY_UPDATED_EVENT } from '../../../modules/products/domain/events/inventory-updated.event';
import { BID_PLACED_EVENT } from '../../../modules/bidding/domain/events/bid-placed.event';
import { AUCTION_ENDED_EVENT } from '../../../modules/bidding/domain/events/auction-ended.event';
import { SELLER_ORDER_STATUS_CHANGED_EVENT } from '../../../modules/orders/domain/events/seller-order-status-changed.event';
import {
  auctionRoom,
  authoritativeSourceForRoom,
  orderRoom,
  productRoom,
  RealtimeEventName,
  RealtimeRoomType,
  sellerOrderRoom,
} from '../realtime.constants';
import type { RealtimeEnvelope } from '../realtime-message.interface';
import { RealtimeGateway } from '../realtime.gateway';

export const REALTIME_CONSUMER_NAME = 'realtime';

// The seam between the domain and the socket. Business services record
// outbox events describing what happened; this translates those facts
// into room broadcasts. Nothing upstream knows a WebSocket exists, and
// nothing here knows why the fact occurred.
//
// Note what is deliberately ABSENT: no EventIdempotencyService. Every
// other consumer dedupes via ProcessedEvent because its side effect is a
// write that must not happen twice. A broadcast is not a write — it
// carries no authority, and clients treat every message as "something
// changed, here is a hint" on top of a snapshot they fetched from
// Postgres. Re-delivering one is harmless, so paying a database
// round-trip per broadcast to prevent it would buy nothing. This is the
// one place where at-least-once delivery needs no guard.
//
// The same reasoning covers late delivery: a job retried after a Redis
// outage may broadcast a fact that is already several minutes stale. The
// envelope is advisory, the client can always `resync` against the
// authoritative endpoint named in it, and no server-side decision is
// made from a broadcast — so a late message degrades to a redundant
// refresh hint rather than corrupting anything.
@Injectable()
@Processor(QueueName.REALTIME)
export class RealtimeConsumer extends DomainEventConsumer {
  private readonly logger = new Logger(RealtimeConsumer.name);

  constructor(
    private readonly gateway: RealtimeGateway,
    correlationIdService: CorrelationIdService,
    private readonly metrics: MetricsService,
  ) {
    super(correlationIdService, metrics, QueueName.REALTIME);
  }

  protected handleEvent(job: Job<DomainEventJob>): Promise<void> {
    const { eventId, eventType, payload } = job.data;
    const envelopes = this.toEnvelopes(eventType, payload);

    if (envelopes.length === 0) {
      this.logger.warn(
        `realtime received an event type it doesn't broadcast: ${eventType} (eventId=${eventId})`,
      );
      return Promise.resolve();
    }

    for (const envelope of envelopes) {
      this.gateway.broadcast(envelope);
      this.metrics.recordWebsocketBroadcast(envelope.event);
    }

    this.logger.log({
      event: 'realtime.broadcast',
      eventId,
      eventType,
      rooms: envelopes.map((e) => e.room),
    });
    return Promise.resolve();
  }

  // A status change is broadcast to BOTH the parent order room and the
  // seller-order room, as two separate messages rather than one message
  // addressed to two rooms. A client watching an order detail page is
  // legitimately subscribed to both and keys its local state by room, so
  // each subscription gets its own correctly-labelled envelope.
  private toEnvelopes(
    eventType: string,
    payload: Record<string, unknown>,
  ): RealtimeEnvelope[] {
    switch (eventType) {
      case INVENTORY_UPDATED_EVENT: {
        const productId = payload.productId as string;
        return [
          this.envelope(
            productRoom(productId),
            RealtimeEventName.INVENTORY_UPDATED,
            payload,
            authoritativeSourceForRoom(RealtimeRoomType.PRODUCT, productId),
          ),
        ];
      }
      case BID_PLACED_EVENT: {
        const auctionId = payload.auctionId as string;
        return [
          this.envelope(
            auctionRoom(auctionId),
            RealtimeEventName.AUCTION_BID_UPDATED,
            payload,
            authoritativeSourceForRoom(RealtimeRoomType.AUCTION, auctionId),
          ),
        ];
      }
      case AUCTION_ENDED_EVENT: {
        const auctionId = payload.auctionId as string;
        return [
          this.envelope(
            auctionRoom(auctionId),
            RealtimeEventName.AUCTION_ENDED,
            payload,
            authoritativeSourceForRoom(RealtimeRoomType.AUCTION, auctionId),
          ),
        ];
      }
      case SELLER_ORDER_STATUS_CHANGED_EVENT: {
        const orderId = payload.orderId as string;
        const sellerOrderId = payload.sellerOrderId as string;
        return [
          this.envelope(
            orderRoom(orderId),
            RealtimeEventName.SELLER_ORDER_STATUS_UPDATED,
            payload,
            authoritativeSourceForRoom(RealtimeRoomType.ORDER, orderId),
          ),
          this.envelope(
            sellerOrderRoom(sellerOrderId),
            RealtimeEventName.SELLER_ORDER_STATUS_UPDATED,
            payload,
            authoritativeSourceForRoom(
              RealtimeRoomType.SELLER_ORDER,
              sellerOrderId,
              orderId,
            ),
          ),
        ];
      }
      default:
        return [];
    }
  }

  private envelope(
    room: string,
    event: RealtimeEventName,
    payload: Record<string, unknown>,
    authoritativeSource: string,
  ): RealtimeEnvelope {
    return {
      room,
      event,
      payload,
      emittedAt: new Date().toISOString(),
      authoritativeSource,
    };
  }

  // Fires outside the job's ALS context, so correlationId is read from
  // the payload and passed explicitly.
  @OnWorkerEvent('failed')
  onFailed(job: Job<DomainEventJob> | undefined, err: Error): void {
    this.logger.error({
      event: 'realtime.job_failed',
      eventId: job?.data.eventId,
      correlationId: job?.data.correlationId,
      jobAttempt: job?.attemptsMade,
      error: err,
    });
  }
}
