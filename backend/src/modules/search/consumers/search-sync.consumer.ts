import { Injectable, Logger } from '@nestjs/common';
import { OnWorkerEvent, Processor } from '@nestjs/bullmq';
import type { Job } from 'bullmq';
import { ProductStatus, type Prisma } from '@prisma/client';
import type { DomainEventJob } from '../../../infrastructure/queue/domain-event-job.interface';
import { DomainEventConsumer } from '../../../infrastructure/queue/domain-event.consumer';
import { CorrelationIdService } from '../../../core/correlation-id/correlation-id.service';
import { MetricsService } from '../../../infrastructure/metrics/metrics.service';
import { QueueName } from '../../../infrastructure/queue/queue.constants';
import { EventIdempotencyService } from '../../../infrastructure/idempotency/event-idempotency.service';
import { MeilisearchService } from '../../../infrastructure/meilisearch/meilisearch.service';
import { PRODUCT_ARCHIVED_EVENT } from '../../products/domain/events/product-archived.event';
import { PRODUCT_CREATED_EVENT } from '../../products/domain/events/product-created.event';
import { PRODUCT_UPDATED_EVENT } from '../../products/domain/events/product-updated.event';
import type { ProductSearchDocument } from '../domain/product-search-document.interface';

export const SEARCH_SYNC_CONSUMER_NAME = 'search-sync';

// The concrete demonstration of PostgreSQL Outbox -> Outbox Publisher ->
// BullMQ -> Worker: this is that Worker for the "search-sync" queue.
// PRODUCT_CREATED/PRODUCT_UPDATED re-read the product from Postgres (the
// source of truth) and upsert a denormalized document; PRODUCT_ARCHIVED
// removes it — an archived product is never discoverable via search.
//
// Idempotent by construction, two layers deep:
//  1. EventIdempotencyService — a ProcessedEvent row keyed on
//     (eventId, 'search-sync') means a redelivered job (BullMQ retry,
//     or the Outbox Publisher republishing after its own crash) is a
//     silent no-op the second time.
//  2. Even without that, addDocuments()/deleteDocument() are themselves
//     idempotent upserts/deletes-by-id — processing the same event
//     twice would still leave Meilisearch in the same end state. Layer 1
//     exists for consumers whose side effects AREN'T naturally
//     idempotent (e.g. a future "increment analytics counter" consumer)
//     — this queue uses the same reusable primitive as a demonstration.
//
// Temporary Meilisearch failure: process() throws, BullMQ retries per
// the job's attempts/backoff (set by QueueService.enqueueDomainEvent) —
// nothing here needs its own retry loop.
@Injectable()
@Processor(QueueName.SEARCH_SYNC)
export class SearchSyncConsumer extends DomainEventConsumer {
  private readonly logger = new Logger(SearchSyncConsumer.name);

  constructor(
    private readonly meilisearch: MeilisearchService,
    private readonly eventIdempotency: EventIdempotencyService,
    correlationIdService: CorrelationIdService,
    metricsService: MetricsService,
  ) {
    super(correlationIdService, metricsService, QueueName.SEARCH_SYNC);
  }

  protected async handleEvent(job: Job<DomainEventJob>): Promise<void> {
    const { eventId, eventType, payload } = job.data;
    const productId = payload.productId as string;

    const result = await this.eventIdempotency.run(
      SEARCH_SYNC_CONSUMER_NAME,
      eventId,
      async (tx) => {
        if (eventType === PRODUCT_ARCHIVED_EVENT) {
          const index = await this.meilisearch.productsIndex();
          await index.deleteDocument(productId);
          return;
        }
        if (
          eventType === PRODUCT_CREATED_EVENT ||
          eventType === PRODUCT_UPDATED_EVENT
        ) {
          await this.syncProduct(tx, productId);
          return;
        }
        this.logger.warn(
          `search-sync received an event type it doesn't handle: ${eventType} (eventId=${eventId})`,
        );
      },
    );

    // correlationId is NOT passed here — AppLogger reads it from the
    // context DomainEventConsumer re-established. Same for every log
    // below and in the other consumers.
    this.logger.log({
      event: 'search_sync.event_processed',
      eventId,
      eventType,
      entityType: 'Product',
      entityId: productId,
      result,
      jobAttempt: job.attemptsMade + 1,
    });
  }

  private async syncProduct(
    tx: Prisma.TransactionClient,
    productId: string,
  ): Promise<void> {
    const product = await tx.product.findUnique({ where: { id: productId } });
    if (!product || product.status === ProductStatus.ARCHIVED) {
      // Archived (or gone) between the event firing and this running —
      // never index a stale/unavailable product.
      const index = await this.meilisearch.productsIndex();
      await index.deleteDocument(productId);
      return;
    }

    const [category, seller, inventory, ratingAgg, hasActiveAuction] =
      await Promise.all([
        tx.category.findUniqueOrThrow({ where: { id: product.categoryId } }),
        tx.sellerProfile.findUniqueOrThrow({ where: { id: product.sellerId } }),
        tx.inventory.findUnique({ where: { productId } }),
        // The PRODUCT's own rating, not the seller's average across
        // their catalogue. A shopper reading a rating on a listing is
        // asking about that item; rolling every product a seller lists
        // into one number would let a strong line carry a weak one.
        tx.review.aggregate({
          where: { productId },
          _avg: { rating: true },
        }),
        // Only ever relevant for AUCTION products, but cheap enough to
        // just always ask — skipping the query for FIXED_PRICE would
        // save one round-trip at the cost of a type-conditional branch
        // for no real benefit (product.type never has an AUCTION row
        // otherwise).
        tx.auction.count({
          where: { productId, status: { in: ['ACTIVE', 'SCHEDULED'] } },
        }),
      ]);

    const doc: ProductSearchDocument = {
      id: product.id,
      name: product.name,
      description: product.description,
      basePrice: Number(product.basePrice),
      categoryId: product.categoryId,
      categoryName: category.name,
      sellerId: product.sellerId,
      sellerName: seller.businessName,
      productRating: ratingAgg._avg.rating,
      type: product.type,
      // quantityAvailable alone: reserved units have already been moved
      // out of it, so subtracting them again would mark a product out of
      // stock while it still has sellable units.
      inStock: (inventory?.quantityAvailable ?? 0) > 0,
      quantityAvailable: inventory?.quantityAvailable ?? 0,
      hasActiveAuction: hasActiveAuction > 0,
      createdAt: product.createdAt.getTime(),
    };

    // Upsert by primaryKey, never an "insert" — safe for both create and
    // update, and safe to call twice for the same document.
    const index = await this.meilisearch.productsIndex();
    await index.addDocuments([doc], { primaryKey: 'id' });
  }

  // Worker lifecycle events fire OUTSIDE the job's ALS context, so the
  // correlationId is read off the job payload and passed explicitly here
  // — the one place that's correct to do so.
  @OnWorkerEvent('failed')
  onFailed(job: Job<DomainEventJob> | undefined, err: Error): void {
    this.logger.error({
      event: 'search_sync.job_failed',
      eventId: job?.data.eventId,
      correlationId: job?.data.correlationId,
      jobAttempt: job?.attemptsMade,
      error: err,
    });
  }
}
