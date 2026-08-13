import { OutboxEventStatus } from '@prisma/client';
import { PRODUCT_CREATED_EVENT } from '../../modules/products/domain/events/product-created.event';
import { SELLER_ORDER_CREATED_EVENT } from '../../modules/orders/domain/events/seller-order-created.event';
import type { PrismaService } from '../prisma/prisma.service';
import { QueueName } from '../queue/queue.constants';
import type { QueueService } from '../queue/queue.service';
import { MAX_ATTEMPTS } from './outbox-publisher.constants';
import { CorrelationIdService } from '../../core/correlation-id/correlation-id.service';
import { MetricsService } from '../metrics/metrics.service';
import { OutboxPublisherService } from './outbox-publisher.service';

function buildClaimedRow(overrides: Partial<Record<string, unknown>> = {}) {
  return {
    id: 'event-1',
    aggregateType: 'Product',
    aggregateId: 'product-1',
    eventType: PRODUCT_CREATED_EVENT,
    payload: { productId: 'product-1' },
    correlationId: 'corr-1',
    attempts: 0,
    ...overrides,
  };
}

describe('OutboxPublisherService', () => {
  let service: OutboxPublisherService;
  let prisma: {
    $queryRaw: jest.Mock;
    outboxEvent: { update: jest.Mock };
  };
  let queueService: jest.Mocked<Pick<QueueService, 'enqueueDomainEvent'>>;

  beforeEach(() => {
    prisma = {
      $queryRaw: jest.fn(),
      outboxEvent: { update: jest.fn() },
    };
    queueService = { enqueueDomainEvent: jest.fn() };
    service = new OutboxPublisherService(
      prisma as unknown as PrismaService,
      queueService as unknown as QueueService,
      // Real instance (no dependencies of its own) so publishing runs
      // inside the event's correlation context, as it does in production.
      new CorrelationIdService(),
      new MetricsService(),
    );
  });

  it('marks a claimed event PUBLISHED only after the BullMQ enqueue resolves, and propagates correlationId', async () => {
    prisma.$queryRaw.mockResolvedValue([buildClaimedRow()]);
    queueService.enqueueDomainEvent.mockResolvedValue(undefined);

    await service.pollOnce();

    expect(queueService.enqueueDomainEvent).toHaveBeenCalledWith(
      QueueName.SEARCH_SYNC,
      expect.objectContaining({
        eventId: 'event-1',
        eventType: PRODUCT_CREATED_EVENT,
        correlationId: 'corr-1',
      }),
    );
    expect(prisma.outboxEvent.update).toHaveBeenCalledWith({
      where: { id: 'event-1' },
      data: expect.objectContaining({ status: OutboxEventStatus.PUBLISHED }),
    });
  });

  it('fans out an event mapped to multiple queues, marking PUBLISHED only once every enqueue resolves', async () => {
    prisma.$queryRaw.mockResolvedValue([
      buildClaimedRow({ eventType: SELLER_ORDER_CREATED_EVENT }),
    ]);
    queueService.enqueueDomainEvent.mockResolvedValue(undefined);

    await service.pollOnce();

    expect(queueService.enqueueDomainEvent).toHaveBeenCalledWith(
      QueueName.ORDER_PROCESSING,
      expect.objectContaining({ eventId: 'event-1' }),
    );
    expect(queueService.enqueueDomainEvent).toHaveBeenCalledWith(
      QueueName.NOTIFICATIONS,
      expect.objectContaining({ eventId: 'event-1' }),
    );
    expect(prisma.outboxEvent.update).toHaveBeenCalledWith({
      where: { id: 'event-1' },
      data: expect.objectContaining({ status: OutboxEventStatus.PUBLISHED }),
    });
  });

  it('does not mark PUBLISHED if only one of several fanned-out queues fails', async () => {
    prisma.$queryRaw.mockResolvedValue([
      buildClaimedRow({ eventType: SELLER_ORDER_CREATED_EVENT }),
    ]);
    queueService.enqueueDomainEvent.mockImplementation(
      (queueName: QueueName) =>
        queueName === QueueName.NOTIFICATIONS
          ? Promise.reject(new Error('redis down'))
          : Promise.resolve(undefined),
    );

    await service.pollOnce();

    const publishedCall = prisma.outboxEvent.update.mock.calls.find(
      ([arg]: [{ data: { status: OutboxEventStatus } }]) =>
        arg.data.status === OutboxEventStatus.PUBLISHED,
    );
    expect(publishedCall).toBeUndefined();
  });

  it('does not mark PUBLISHED if the enqueue call itself throws', async () => {
    prisma.$queryRaw.mockResolvedValue([buildClaimedRow()]);
    queueService.enqueueDomainEvent.mockRejectedValue(new Error('redis down'));

    await service.pollOnce();

    const publishedCall = prisma.outboxEvent.update.mock.calls.find(
      ([arg]: [{ data: { status: OutboxEventStatus } }]) =>
        arg.data.status === OutboxEventStatus.PUBLISHED,
    );
    expect(publishedCall).toBeUndefined();
  });

  it('requeues with exponential backoff after a queue failure, so the event is retried rather than lost', async () => {
    prisma.$queryRaw.mockResolvedValue([buildClaimedRow({ attempts: 0 })]);
    queueService.enqueueDomainEvent.mockRejectedValue(new Error('redis down'));

    const before = Date.now();
    await service.pollOnce();

    expect(prisma.outboxEvent.update).toHaveBeenCalledWith({
      where: { id: 'event-1' },
      data: expect.objectContaining({
        status: OutboxEventStatus.PENDING,
        attempts: 1,
        lastError: 'redis down',
      }),
    });
    const [{ data }] = prisma.outboxEvent.update.mock.calls[0] as [
      { data: { availableAt: Date } },
    ];
    expect(data.availableAt.getTime()).toBeGreaterThan(before);
  });

  it('parks an event as FAILED once MAX_ATTEMPTS is exhausted, instead of retrying forever', async () => {
    prisma.$queryRaw.mockResolvedValue([
      buildClaimedRow({ attempts: MAX_ATTEMPTS - 1 }),
    ]);
    queueService.enqueueDomainEvent.mockRejectedValue(new Error('still down'));

    await service.pollOnce();

    expect(prisma.outboxEvent.update).toHaveBeenCalledWith({
      where: { id: 'event-1' },
      data: expect.objectContaining({
        status: OutboxEventStatus.FAILED,
        attempts: MAX_ATTEMPTS,
      }),
    });
  });

  // Not FAILED: an event type without a consumer implemented yet is
  // expected project scope ("do not implement all consumers yet"), not
  // a bug — it's left PENDING so it's naturally picked up once a
  // mapping/consumer is added later, no backfill needed.
  it('leaves an event PENDING (not FAILED) with a long recheck delay when its event type has no known queue mapping yet', async () => {
    prisma.$queryRaw.mockResolvedValue([
      buildClaimedRow({ eventType: 'SomeUnroutedEvent' }),
    ]);
    const before = Date.now();

    await service.pollOnce();

    expect(queueService.enqueueDomainEvent).not.toHaveBeenCalled();
    expect(prisma.outboxEvent.update).toHaveBeenCalledWith({
      where: { id: 'event-1' },
      data: expect.objectContaining({ status: OutboxEventStatus.PENDING }),
    });
    const [{ data }] = prisma.outboxEvent.update.mock.calls[0] as [
      { data: { availableAt: Date } },
    ];
    // Rechecked much later, not on the next 2s poll — see
    // UNMAPPED_EVENT_RECHECK_MS.
    expect(data.availableAt.getTime()).toBeGreaterThan(before + 60_000);
  });

  it('does not let one poll overlap another while a previous poll is still running', async () => {
    let resolveFirstQuery!: (rows: unknown[]) => void;
    prisma.$queryRaw
      .mockImplementationOnce(
        () =>
          new Promise((resolve) => {
            resolveFirstQuery = resolve;
          }),
      )
      .mockResolvedValueOnce([]);

    const firstPoll = service.pollOnce();
    const secondPoll = service.pollOnce(); // should be a no-op — first poll still in flight

    resolveFirstQuery([]);
    await Promise.all([firstPoll, secondPoll]);

    expect(prisma.$queryRaw).toHaveBeenCalledTimes(1);
  });
});
