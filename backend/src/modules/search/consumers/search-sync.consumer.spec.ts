import { Prisma, ProductStatus, ProductType } from '@prisma/client';
import type { Job } from 'bullmq';
import type { DomainEventJob } from '../../../infrastructure/queue/domain-event-job.interface';
import { EventIdempotencyService } from '../../../infrastructure/idempotency/event-idempotency.service';
import type { MeilisearchService } from '../../../infrastructure/meilisearch/meilisearch.service';
import { PRODUCT_ARCHIVED_EVENT } from '../../products/domain/events/product-archived.event';
import { PRODUCT_CREATED_EVENT } from '../../products/domain/events/product-created.event';
import { PRODUCT_UPDATED_EVENT } from '../../products/domain/events/product-updated.event';
import { CorrelationIdService } from '../../../core/correlation-id/correlation-id.service';
import { MetricsService } from '../../../infrastructure/metrics/metrics.service';
import { SearchSyncConsumer } from './search-sync.consumer';

function buildJob(
  overrides: Partial<DomainEventJob> = {},
): Job<DomainEventJob> {
  return {
    data: {
      eventId: 'event-1',
      eventType: PRODUCT_CREATED_EVENT,
      aggregateType: 'Product',
      aggregateId: 'product-1',
      correlationId: 'corr-1',
      payload: { productId: 'product-1' },
      ...overrides,
    },
    attemptsMade: 0,
  } as unknown as Job<DomainEventJob>;
}

const PRODUCT_ROW = {
  id: 'product-1',
  sellerId: 'seller-1',
  categoryId: 'category-1',
  name: 'Widget',
  description: 'A widget',
  basePrice: '19.99',
  type: ProductType.FIXED_PRICE,
  status: ProductStatus.ACTIVE,
  createdAt: new Date('2026-01-01T00:00:00Z'),
};

describe('SearchSyncConsumer', () => {
  let consumer: SearchSyncConsumer;
  let addDocuments: jest.Mock;
  let deleteDocument: jest.Mock;
  let tx: {
    product: { findUnique: jest.Mock };
    category: { findUniqueOrThrow: jest.Mock };
    sellerProfile: { findUniqueOrThrow: jest.Mock };
    inventory: { findUnique: jest.Mock };
    review: { aggregate: jest.Mock };
  };

  beforeEach(() => {
    addDocuments = jest.fn().mockResolvedValue(undefined);
    deleteDocument = jest.fn().mockResolvedValue(undefined);
    const meilisearch = {
      productsIndex: () => Promise.resolve({ addDocuments, deleteDocument }),
    } as unknown as MeilisearchService;

    tx = {
      product: { findUnique: jest.fn().mockResolvedValue(PRODUCT_ROW) },
      category: {
        findUniqueOrThrow: jest.fn().mockResolvedValue({ name: 'Gadgets' }),
      },
      sellerProfile: {
        findUniqueOrThrow: jest
          .fn()
          .mockResolvedValue({ businessName: 'Acme' }),
      },
      inventory: {
        findUnique: jest
          .fn()
          .mockResolvedValue({ quantityAvailable: 10, quantityReserved: 2 }),
      },
      review: {
        aggregate: jest.fn().mockResolvedValue({ _avg: { rating: 4.5 } }),
      },
    };

    // A real EventIdempotencyService, backed by a fake PrismaService —
    // exercises the actual dedupe logic (not a stub), matching how it
    // really runs in production against the ProcessedEvent table.
    const processedEventCreate = jest.fn().mockResolvedValue({});
    const eventIdempotency = new EventIdempotencyService({
      $transaction: jest.fn((cb: (tx: unknown) => unknown) =>
        cb({ ...tx, processedEvent: { create: processedEventCreate } }),
      ),
    } as never);
    (
      eventIdempotency as unknown as { __processedEventCreate: jest.Mock }
    ).__processedEventCreate = processedEventCreate;

    // A real CorrelationIdService (it has no dependencies of its own),
    // so calling process() actually exercises the AsyncLocalStorage
    // re-entry that DomainEventConsumer performs.
    consumer = new SearchSyncConsumer(
      meilisearch,
      eventIdempotency,
      new CorrelationIdService(),
      // Real MetricsService too — it owns its own registry, so
      // instances don't collide, and using the real one catches a
      // mislabelled metric call that a jest.fn() would swallow.
      new MetricsService(),
    );
    (
      consumer as unknown as { __processedEventCreate: jest.Mock }
    ).__processedEventCreate = processedEventCreate;
  });

  it('product indexed: upserts a document built from PostgreSQL on ProductCreated', async () => {
    await consumer.process(buildJob({ eventType: PRODUCT_CREATED_EVENT }));

    expect(addDocuments).toHaveBeenCalledWith(
      [
        expect.objectContaining({
          id: 'product-1',
          name: 'Widget',
          categoryName: 'Gadgets',
          sellerName: 'Acme',
          sellerRating: 4.5,
          inStock: true, // 10 available - 2 reserved > 0
        }),
      ],
      { primaryKey: 'id' },
    );
  });

  it('product updated: also upserts (never a separate "insert" path)', async () => {
    await consumer.process(buildJob({ eventType: PRODUCT_UPDATED_EVENT }));

    expect(addDocuments).toHaveBeenCalledTimes(1);
    expect(deleteDocument).not.toHaveBeenCalled();
  });

  it('product removed/deactivated: deletes the document on ProductArchived without reading Postgres', async () => {
    await consumer.process(buildJob({ eventType: PRODUCT_ARCHIVED_EVENT }));

    expect(deleteDocument).toHaveBeenCalledWith('product-1');
    expect(addDocuments).not.toHaveBeenCalled();
  });

  it('a product archived between the event firing and processing is removed, not indexed stale', async () => {
    tx.product.findUnique.mockResolvedValue({
      ...PRODUCT_ROW,
      status: ProductStatus.ARCHIVED,
    });

    await consumer.process(buildJob({ eventType: PRODUCT_UPDATED_EVENT }));

    expect(deleteDocument).toHaveBeenCalledWith('product-1');
    expect(addDocuments).not.toHaveBeenCalled();
  });

  it('duplicate event: processing the same eventId twice only calls Meilisearch once', async () => {
    const processedEventCreate = (
      consumer as unknown as { __processedEventCreate: jest.Mock }
    ).__processedEventCreate;

    await consumer.process(buildJob());
    expect(addDocuments).toHaveBeenCalledTimes(1);

    // Second delivery: the ProcessedEvent insert now fails with a unique
    // violation, exactly as it would against a real ProcessedEvent row
    // already written by the first delivery. Uses the real Prisma error
    // class so EventIdempotencyService's instanceof check recognizes it.
    processedEventCreate.mockRejectedValueOnce(
      new Prisma.PrismaClientKnownRequestError('Unique constraint failed', {
        code: 'P2002',
        clientVersion: 'test',
      }),
    );

    await consumer.process(buildJob());

    expect(addDocuments).toHaveBeenCalledTimes(1); // still just once
  });

  it('temporary search-engine failure: a Meilisearch error propagates so BullMQ retries the job', async () => {
    addDocuments.mockRejectedValue(new Error('Meilisearch unreachable'));

    await expect(consumer.process(buildJob())).rejects.toThrow(
      'Meilisearch unreachable',
    );
  });
});
