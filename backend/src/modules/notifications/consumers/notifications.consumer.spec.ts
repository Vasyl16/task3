import { Prisma } from '@prisma/client';
import type { Job } from 'bullmq';
import type { DomainEventJob } from '../../../infrastructure/queue/domain-event-job.interface';
import { EventIdempotencyService } from '../../../infrastructure/idempotency/event-idempotency.service';
import type { NotificationsService } from '../notifications.service';
import { SELLER_ORDER_CREATED_EVENT } from '../../orders/domain/events/seller-order-created.event';
import { SELLER_ORDER_STATUS_CHANGED_EVENT } from '../../orders/domain/events/seller-order-status-changed.event';
import { AUCTION_ENDED_EVENT } from '../../bidding/domain/events/auction-ended.event';
import { CorrelationIdService } from '../../../core/correlation-id/correlation-id.service';
import { MetricsService } from '../../../infrastructure/metrics/metrics.service';
import { NotificationsConsumer } from './notifications.consumer';

function buildJob(
  overrides: Partial<DomainEventJob> = {},
): Job<DomainEventJob> {
  return {
    data: {
      eventId: 'event-1',
      eventType: SELLER_ORDER_CREATED_EVENT,
      aggregateType: 'SellerOrder',
      aggregateId: 'seller-order-1',
      correlationId: 'corr-1',
      payload: {
        sellerOrderId: 'seller-order-1',
        orderId: 'order-1',
        sellerUserId: 'seller-user-1',
      },
      ...overrides,
    },
    attemptsMade: 0,
  } as unknown as Job<DomainEventJob>;
}

const AUCTION_ROW = {
  id: 'auction-1',
  productId: 'product-1',
  product: { id: 'product-1', name: 'Vintage Lamp' },
};

const SELLER_ORDER_ROW = {
  id: 'seller-order-1',
  orderId: 'order-1',
  seller: { id: 'seller-1', businessName: 'Aurora Goods' },
};

describe('NotificationsConsumer', () => {
  let consumer: NotificationsConsumer;
  let create: jest.Mock;
  let auctionFindUniqueOrThrow: jest.Mock;
  let sellerOrderFindUniqueOrThrow: jest.Mock;
  let processedEventCreate: jest.Mock;

  beforeEach(() => {
    create = jest.fn().mockResolvedValue({});
    const notificationsService = { create } as unknown as NotificationsService;

    auctionFindUniqueOrThrow = jest.fn().mockResolvedValue(AUCTION_ROW);
    sellerOrderFindUniqueOrThrow = jest
      .fn()
      .mockResolvedValue(SELLER_ORDER_ROW);
    processedEventCreate = jest.fn().mockResolvedValue({});

    const eventIdempotency = new EventIdempotencyService({
      $transaction: jest.fn((cb: (tx: unknown) => unknown) =>
        cb({
          auction: { findUniqueOrThrow: auctionFindUniqueOrThrow },
          sellerOrder: { findUniqueOrThrow: sellerOrderFindUniqueOrThrow },
          processedEvent: { create: processedEventCreate },
        }),
      ),
    } as never);

    consumer = new NotificationsConsumer(
      notificationsService,
      eventIdempotency,
      new CorrelationIdService(),
      new MetricsService(),
    );
  });

  it('SellerOrderCreated: notifies the seller directly from the payload', async () => {
    await consumer.process(buildJob());

    expect(create).toHaveBeenCalledWith(expect.anything(), {
      userId: 'seller-user-1',
      type: 'SELLER_ORDER_CREATED',
      title: 'New order received',
      body: 'You have a new order (SellerOrder seller-order-1).',
      data: { sellerOrderId: 'seller-order-1', orderId: 'order-1' },
    });
  });

  it('ignores event types it does not handle', async () => {
    await consumer.process(buildJob({ eventType: 'SomethingElse' }));

    expect(create).not.toHaveBeenCalled();
  });

  describe('AuctionEnded', () => {
    function buildAuctionEndedJob(
      winningBidderId: string | null,
    ): Job<DomainEventJob> {
      return buildJob({
        eventType: AUCTION_ENDED_EVENT,
        payload: {
          auctionId: 'auction-1',
          winningBidderId,
          winningAmount: winningBidderId ? '120.00' : null,
        },
      });
    }

    it('notifies the winning bidder', async () => {
      await consumer.process(buildAuctionEndedJob('bidder-1'));

      expect(auctionFindUniqueOrThrow).toHaveBeenCalledWith({
        where: { id: 'auction-1' },
        include: { product: true },
      });
      expect(create).toHaveBeenCalledWith(expect.anything(), {
        userId: 'bidder-1',
        type: 'AUCTION_WON',
        title: 'You won an auction!',
        body: 'Your bid won the auction for "Vintage Lamp". Check out from My Auctions to claim it.',
        data: { auctionId: 'auction-1', productId: 'product-1' },
      });
    });

    it('creates no notification when the auction ended with no winner', async () => {
      await consumer.process(buildAuctionEndedJob(null));

      expect(auctionFindUniqueOrThrow).not.toHaveBeenCalled();
      expect(create).not.toHaveBeenCalled();
    });
  });

  describe('SellerOrderStatusChanged', () => {
    function buildStatusChangedJob(status: string): Job<DomainEventJob> {
      return buildJob({
        eventType: SELLER_ORDER_STATUS_CHANGED_EVENT,
        payload: {
          sellerOrderId: 'seller-order-1',
          orderId: 'order-1',
          buyerId: 'buyer-1',
          status,
          orderStatus: 'PARTIALLY_SHIPPED',
        },
      });
    }

    it('notifies the buyer when a SellerOrder transitions into SHIPPED', async () => {
      await consumer.process(buildStatusChangedJob('SHIPPED'));

      expect(sellerOrderFindUniqueOrThrow).toHaveBeenCalledWith({
        where: { id: 'seller-order-1' },
        include: { seller: true },
      });
      expect(create).toHaveBeenCalledWith(expect.anything(), {
        userId: 'buyer-1',
        type: 'SELLER_ORDER_STATUS_CHANGED',
        title: 'Your order has shipped',
        body: "Aurora Goods shipped your order. It's on its way.",
        data: {
          sellerOrderId: 'seller-order-1',
          orderId: 'order-1',
          status: 'SHIPPED',
        },
      });
    });

    it('notifies the buyer on COMPLETED and CANCELLED too', async () => {
      await consumer.process(buildStatusChangedJob('COMPLETED'));
      expect(create).toHaveBeenLastCalledWith(
        expect.anything(),
        expect.objectContaining({ title: 'Order completed' }),
      );

      await consumer.process(buildStatusChangedJob('CANCELLED'));
      expect(create).toHaveBeenLastCalledWith(
        expect.anything(),
        expect.objectContaining({ title: 'Order cancelled' }),
      );
    });

    it.each(['NEW', 'PROCESSING'])(
      'does not notify on a transition into %s',
      async (status) => {
        await consumer.process(buildStatusChangedJob(status));

        expect(sellerOrderFindUniqueOrThrow).not.toHaveBeenCalled();
        expect(create).not.toHaveBeenCalled();
      },
    );
  });

  it('duplicate delivery: processing the same eventId twice only notifies once', async () => {
    await consumer.process(buildJob());
    expect(create).toHaveBeenCalledTimes(1);

    processedEventCreate.mockRejectedValueOnce(
      new Prisma.PrismaClientKnownRequestError('Unique constraint failed', {
        code: 'P2002',
        clientVersion: 'test',
      }),
    );

    await consumer.process(buildJob());

    expect(create).toHaveBeenCalledTimes(1);
  });

  it('propagates an unexpected failure so BullMQ retries the job', async () => {
    auctionFindUniqueOrThrow.mockRejectedValue(new Error('connection lost'));

    await expect(
      consumer.process(
        buildJob({
          eventType: AUCTION_ENDED_EVENT,
          payload: { auctionId: 'auction-1', winningBidderId: 'bidder-1' },
        }),
      ),
    ).rejects.toThrow('connection lost');
  });
});
