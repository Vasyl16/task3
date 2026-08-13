import type { Job } from 'bullmq';
import type { DomainEventJob } from '../../queue/domain-event-job.interface';
import { INVENTORY_UPDATED_EVENT } from '../../../modules/products/domain/events/inventory-updated.event';
import { BID_PLACED_EVENT } from '../../../modules/bidding/domain/events/bid-placed.event';
import { AUCTION_ENDED_EVENT } from '../../../modules/bidding/domain/events/auction-ended.event';
import { SELLER_ORDER_STATUS_CHANGED_EVENT } from '../../../modules/orders/domain/events/seller-order-status-changed.event';
import { RealtimeEventName } from '../realtime.constants';
import type { RealtimeEnvelope } from '../realtime-message.interface';
import type { RealtimeGateway } from '../realtime.gateway';
import { CorrelationIdService } from '../../../core/correlation-id/correlation-id.service';
import { MetricsService } from '../../metrics/metrics.service';
import { RealtimeConsumer } from './realtime.consumer';

function buildJob(
  eventType: string,
  payload: Record<string, unknown>,
): Job<DomainEventJob> {
  return {
    data: {
      eventId: 'event-1',
      eventType,
      aggregateType: 'Test',
      aggregateId: 'agg-1',
      correlationId: 'corr-1',
      payload,
    },
    attemptsMade: 0,
  } as Job<DomainEventJob>;
}

describe('RealtimeConsumer', () => {
  let consumer: RealtimeConsumer;
  let gateway: { broadcast: jest.Mock };

  beforeEach(() => {
    gateway = { broadcast: jest.fn() };
    consumer = new RealtimeConsumer(
      gateway as unknown as RealtimeGateway,
      new CorrelationIdService(),
      new MetricsService(),
    );
  });

  function broadcasts(): RealtimeEnvelope[] {
    return gateway.broadcast.mock.calls.map(
      ([envelope]: [RealtimeEnvelope]) => envelope,
    );
  }

  it('broadcasts an inventory change to that product’s room', async () => {
    await consumer.process(
      buildJob(INVENTORY_UPDATED_EVENT, {
        productId: 'p1',
        quantityAvailable: 3,
        quantityReserved: 2,
        reason: 'CHECKOUT',
      }),
    );

    expect(broadcasts()).toEqual([
      {
        room: 'product:p1',
        event: RealtimeEventName.INVENTORY_UPDATED,
        payload: {
          productId: 'p1',
          quantityAvailable: 3,
          quantityReserved: 2,
          reason: 'CHECKOUT',
        },
        emittedAt: expect.any(String) as string,
        authoritativeSource: 'GET /products/p1',
      },
    ]);
  });

  it('broadcasts a new bid to that auction’s room', async () => {
    await consumer.process(
      buildJob(BID_PLACED_EVENT, {
        auctionId: 'a1',
        bidId: 'b1',
        bidderId: 'user-1',
        amount: 25,
      }),
    );

    expect(broadcasts()).toMatchObject([
      {
        room: 'auction:a1',
        event: RealtimeEventName.AUCTION_BID_UPDATED,
        authoritativeSource: 'GET /auctions/a1',
      },
    ]);
  });

  it('broadcasts the end of an auction to the same room bidders are already watching', async () => {
    await consumer.process(
      buildJob(AUCTION_ENDED_EVENT, {
        auctionId: 'a1',
        winningBidderId: 'user-1',
        winningAmount: '25.00',
      }),
    );

    expect(broadcasts()).toMatchObject([
      { room: 'auction:a1', event: RealtimeEventName.AUCTION_ENDED },
    ]);
  });

  // A buyer watching the whole order and a seller watching just their
  // half are different subscriptions that both need this fact.
  it('broadcasts a SellerOrder status change to both the parent order room and the seller-order room', async () => {
    await consumer.process(
      buildJob(SELLER_ORDER_STATUS_CHANGED_EVENT, {
        sellerOrderId: 's1',
        orderId: 'o1',
        status: 'SHIPPED',
        orderStatus: 'PARTIALLY_SHIPPED',
      }),
    );

    expect(broadcasts()).toMatchObject([
      {
        room: 'order:o1',
        event: RealtimeEventName.SELLER_ORDER_STATUS_UPDATED,
        authoritativeSource: 'GET /orders/o1',
      },
      {
        room: 'seller-order:s1',
        event: RealtimeEventName.SELLER_ORDER_STATUS_UPDATED,
        // A SellerOrder is only readable through its parent order.
        authoritativeSource: 'GET /orders/o1',
      },
    ]);
  });

  it('carries the parent order’s aggregate status alongside the seller’s own', async () => {
    await consumer.process(
      buildJob(SELLER_ORDER_STATUS_CHANGED_EVENT, {
        sellerOrderId: 's1',
        orderId: 'o1',
        status: 'SHIPPED',
        orderStatus: 'PARTIALLY_SHIPPED',
      }),
    );

    expect(broadcasts()[0].payload).toMatchObject({
      status: 'SHIPPED',
      orderStatus: 'PARTIALLY_SHIPPED',
    });
  });

  // An unrouted event must not take the worker down — the outbox may
  // legitimately carry event types this consumer doesn't broadcast.
  it('ignores an event type it does not broadcast, without throwing', async () => {
    await expect(
      consumer.process(buildJob('SomethingElseHappened', { id: 'x' })),
    ).resolves.toBeUndefined();
    expect(gateway.broadcast).not.toHaveBeenCalled();
  });

  // The deliberate absence of ProcessedEvent dedupe: re-delivery is
  // allowed to re-broadcast, because a broadcast carries no authority.
  it('re-broadcasts a redelivered event rather than deduping it', async () => {
    const job = buildJob(BID_PLACED_EVENT, { auctionId: 'a1', amount: 25 });

    await consumer.process(job);
    await consumer.process(job);

    expect(gateway.broadcast).toHaveBeenCalledTimes(2);
  });
});
