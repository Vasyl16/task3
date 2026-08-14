import { Prisma } from '@prisma/client';
import type { Job } from 'bullmq';
import type { DomainEventJob } from '../../../infrastructure/queue/domain-event-job.interface';
import { EventIdempotencyService } from '../../../infrastructure/idempotency/event-idempotency.service';
import type { EmailService } from '../email.service';
import { ORDER_PLACED_EVENT } from '../../orders/domain/events/order-placed.event';
import { SELLER_ORDER_CREATED_EVENT } from '../../orders/domain/events/seller-order-created.event';
import { SELLER_ORDER_STATUS_CHANGED_EVENT } from '../../orders/domain/events/seller-order-status-changed.event';
import { AUCTION_ENDED_EVENT } from '../../bidding/domain/events/auction-ended.event';
import { CorrelationIdService } from '../../../core/correlation-id/correlation-id.service';
import { MetricsService } from '../../../infrastructure/metrics/metrics.service';
import { EmailConsumer } from './email.consumer';

function buildJob(
  overrides: Partial<DomainEventJob> = {},
): Job<DomainEventJob> {
  return {
    data: {
      eventId: 'event-1',
      eventType: ORDER_PLACED_EVENT,
      aggregateType: 'Order',
      aggregateId: 'order-1',
      correlationId: 'corr-1',
      payload: { orderId: 'order-1', buyerId: 'buyer-1', sellerOrderIds: [] },
      ...overrides,
    },
    attemptsMade: 0,
  } as unknown as Job<DomainEventJob>;
}

const ORDER_ROW = {
  id: 'order-1',
  totalAmount: new Prisma.Decimal('49.98'),
  placedAt: new Date('2026-01-01T00:00:00Z'),
  buyer: { id: 'buyer-1', email: 'buyer@example.com', name: 'Jamie Buyer' },
};

const SELLER_ORDER_ROW = {
  id: 'seller-order-1',
  orderId: 'order-1',
  subtotal: new Prisma.Decimal('80.00'),
  order: {
    buyer: { id: 'buyer-1', email: 'buyer@example.com', name: 'Jamie Buyer' },
  },
  seller: { id: 'seller-1', businessName: 'Aurora Goods' },
};

const AUCTION_ROW = {
  id: 'auction-1',
  productId: 'product-1',
  currentHighestBid: new Prisma.Decimal('120.00'),
  checkoutDeadline: new Date('2026-01-03T00:00:00Z'),
  product: { id: 'product-1', name: 'Vintage Lamp' },
};

const WINNER_ROW = {
  id: 'bidder-1',
  email: 'bidder@example.com',
  name: 'Riley Bidder',
};

const SELLER_USER_ROW = {
  id: 'seller-user-1',
  email: 'seller@example.com',
  name: 'Sasha Seller',
};

const USER_ROWS_BY_ID: Record<string, unknown> = {
  [WINNER_ROW.id]: WINNER_ROW,
  [SELLER_USER_ROW.id]: SELLER_USER_ROW,
};

describe('EmailConsumer', () => {
  let consumer: EmailConsumer;
  let sendPaymentReceipt: jest.Mock;
  let sendOrderStatusUpdate: jest.Mock;
  let sendAuctionWon: jest.Mock;
  let sendNewOrderReceived: jest.Mock;
  let orderFindUniqueOrThrow: jest.Mock;
  let sellerOrderFindUniqueOrThrow: jest.Mock;
  let auctionFindUniqueOrThrow: jest.Mock;
  let userFindUniqueOrThrow: jest.Mock;
  let processedEventCreate: jest.Mock;

  beforeEach(() => {
    sendPaymentReceipt = jest.fn().mockResolvedValue(undefined);
    sendOrderStatusUpdate = jest.fn().mockResolvedValue(undefined);
    sendAuctionWon = jest.fn().mockResolvedValue(undefined);
    sendNewOrderReceived = jest.fn().mockResolvedValue(undefined);
    const emailService = {
      sendPaymentReceipt,
      sendOrderStatusUpdate,
      sendAuctionWon,
      sendNewOrderReceived,
    } as unknown as EmailService;

    orderFindUniqueOrThrow = jest.fn().mockResolvedValue(ORDER_ROW);
    sellerOrderFindUniqueOrThrow = jest
      .fn()
      .mockResolvedValue(SELLER_ORDER_ROW);
    auctionFindUniqueOrThrow = jest.fn().mockResolvedValue(AUCTION_ROW);
    userFindUniqueOrThrow = jest.fn(
      ({ where: { id } }: { where: { id: string } }) =>
        Promise.resolve(USER_ROWS_BY_ID[id]),
    );

    // A real EventIdempotencyService, backed by a fake PrismaService —
    // exercises the actual dedupe logic, matching SearchSyncConsumer's
    // spec.
    processedEventCreate = jest.fn().mockResolvedValue({});
    const eventIdempotency = new EventIdempotencyService({
      $transaction: jest.fn((cb: (tx: unknown) => unknown) =>
        cb({
          order: { findUniqueOrThrow: orderFindUniqueOrThrow },
          sellerOrder: { findUniqueOrThrow: sellerOrderFindUniqueOrThrow },
          auction: { findUniqueOrThrow: auctionFindUniqueOrThrow },
          user: { findUniqueOrThrow: userFindUniqueOrThrow },
          processedEvent: { create: processedEventCreate },
        }),
      ),
    } as never);

    consumer = new EmailConsumer(
      emailService,
      eventIdempotency,
      new CorrelationIdService(),
      new MetricsService(),
    );
  });

  it('order placed: re-reads the order/buyer from Postgres and sends a receipt', async () => {
    await consumer.process(buildJob());

    expect(orderFindUniqueOrThrow).toHaveBeenCalledWith({
      where: { id: 'order-1' },
      include: { buyer: true },
    });
    expect(sendPaymentReceipt).toHaveBeenCalledWith('buyer@example.com', {
      orderId: 'order-1',
      buyerName: 'Jamie Buyer',
      totalAmount: '49.98',
      placedAt: ORDER_ROW.placedAt,
    });
  });

  it('ignores event types it does not handle', async () => {
    await consumer.process(buildJob({ eventType: 'SomethingElse' }));

    expect(orderFindUniqueOrThrow).not.toHaveBeenCalled();
    expect(sendPaymentReceipt).not.toHaveBeenCalled();
  });

  it('duplicate delivery: processing the same eventId twice only sends once', async () => {
    await consumer.process(buildJob());
    expect(sendPaymentReceipt).toHaveBeenCalledTimes(1);

    processedEventCreate.mockRejectedValueOnce(
      new Prisma.PrismaClientKnownRequestError('Unique constraint failed', {
        code: 'P2002',
        clientVersion: 'test',
      }),
    );

    await consumer.process(buildJob());

    expect(sendPaymentReceipt).toHaveBeenCalledTimes(1); // still just once
  });

  it('a rejected Resend send does not throw — it must not block redelivery or fail the job', async () => {
    sendPaymentReceipt.mockResolvedValue(undefined); // EmailService swallows Resend errors itself

    await expect(consumer.process(buildJob())).resolves.toBeUndefined();
  });

  it('propagates an unexpected failure so BullMQ retries the job', async () => {
    orderFindUniqueOrThrow.mockRejectedValue(new Error('connection lost'));

    await expect(consumer.process(buildJob())).rejects.toThrow(
      'connection lost',
    );
  });

  describe('SellerOrderCreated', () => {
    function buildOrderCreatedJob(): Job<DomainEventJob> {
      return buildJob({
        eventType: SELLER_ORDER_CREATED_EVENT,
        payload: {
          sellerOrderId: 'seller-order-1',
          orderId: 'order-1',
          sellerId: 'seller-1',
          sellerUserId: 'seller-user-1',
        },
      });
    }

    it('mails the seller when a new SellerOrder is created', async () => {
      await consumer.process(buildOrderCreatedJob());

      expect(sellerOrderFindUniqueOrThrow).toHaveBeenCalledWith({
        where: { id: 'seller-order-1' },
        include: { order: { include: { buyer: true } } },
      });
      expect(userFindUniqueOrThrow).toHaveBeenCalledWith({
        where: { id: 'seller-user-1' },
      });
      expect(sendNewOrderReceived).toHaveBeenCalledWith('seller@example.com', {
        orderId: 'order-1',
        sellerOrderId: 'seller-order-1',
        sellerName: 'Sasha Seller',
        buyerName: 'Jamie Buyer',
        subtotal: '80',
      });
    });
  });

  describe('SellerOrderStatusChanged', () => {
    function buildStatusChangedJob(status: string): Job<DomainEventJob> {
      return buildJob({
        eventType: SELLER_ORDER_STATUS_CHANGED_EVENT,
        payload: {
          sellerOrderId: 'seller-order-1',
          orderId: 'order-1',
          status,
          orderStatus: 'PARTIALLY_SHIPPED',
        },
      });
    }

    it('mails the buyer when a SellerOrder transitions into SHIPPED', async () => {
      await consumer.process(buildStatusChangedJob('SHIPPED'));

      expect(sellerOrderFindUniqueOrThrow).toHaveBeenCalledWith({
        where: { id: 'seller-order-1' },
        include: { order: { include: { buyer: true } }, seller: true },
      });
      expect(sendOrderStatusUpdate).toHaveBeenCalledWith('buyer@example.com', {
        orderId: 'order-1',
        sellerOrderId: 'seller-order-1',
        buyerName: 'Jamie Buyer',
        sellerName: 'Aurora Goods',
        status: 'SHIPPED',
      });
    });

    it.each(['COMPLETED', 'CANCELLED'])(
      'also mails the buyer on a transition into %s',
      async (status) => {
        await consumer.process(buildStatusChangedJob(status));

        expect(sendOrderStatusUpdate).toHaveBeenCalledWith(
          'buyer@example.com',
          expect.objectContaining({ status }),
        );
      },
    );

    it.each(['NEW', 'PROCESSING'])(
      'does not mail on a transition into %s',
      async (status) => {
        await consumer.process(buildStatusChangedJob(status));

        expect(sellerOrderFindUniqueOrThrow).not.toHaveBeenCalled();
        expect(sendOrderStatusUpdate).not.toHaveBeenCalled();
      },
    );
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

    it('mails the winning bidder', async () => {
      await consumer.process(buildAuctionEndedJob('bidder-1'));

      expect(auctionFindUniqueOrThrow).toHaveBeenCalledWith({
        where: { id: 'auction-1' },
        include: { product: true },
      });
      expect(userFindUniqueOrThrow).toHaveBeenCalledWith({
        where: { id: 'bidder-1' },
      });
      expect(sendAuctionWon).toHaveBeenCalledWith('bidder@example.com', {
        auctionId: 'auction-1',
        productName: 'Vintage Lamp',
        winnerName: 'Riley Bidder',
        winningAmount: '120',
        checkoutDeadline: AUCTION_ROW.checkoutDeadline,
      });
    });

    it('sends no email when the auction ended with no winner', async () => {
      await consumer.process(buildAuctionEndedJob(null));

      expect(auctionFindUniqueOrThrow).not.toHaveBeenCalled();
      expect(sendAuctionWon).not.toHaveBeenCalled();
    });
  });
});
