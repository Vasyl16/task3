import {
  Injectable,
  Logger,
  OnModuleDestroy,
  OnModuleInit,
} from '@nestjs/common';
import { OutboxEventStatus, Prisma } from '@prisma/client';
import { CorrelationIdService } from '../../core/correlation-id/correlation-id.service';
import { MetricsService } from '../metrics/metrics.service';
import { PrismaService } from '../prisma/prisma.service';
import { QueueService } from '../queue/queue.service';
import { resolveQueuesForEventType } from './event-queue-map';
import {
  CLAIM_BATCH_SIZE,
  computeBackoffMs,
  MAX_ATTEMPTS,
  POLL_INTERVAL_MS,
  STUCK_PROCESSING_MS,
  UNMAPPED_EVENT_RECHECK_MS,
} from './outbox-publisher.constants';

interface ClaimedOutboxEventRow {
  id: string;
  aggregateType: string;
  aggregateId: string;
  eventType: string;
  payload: Record<string, unknown>;
  correlationId: string;
  attempts: number;
}

// The relay half of the transactional outbox pattern: polls Postgres for
// rows a business transaction committed via OutboxService.record(), and
// pushes each one onto the BullMQ queue its event type maps to (see
// event-queue-map.ts). A row is marked PUBLISHED only after the BullMQ
// enqueue has actually resolved — never optimistically.
//
// Reliability properties:
//  - Claiming uses `UPDATE ... WHERE id IN (SELECT ... FOR UPDATE SKIP
//    LOCKED)` in one statement, so multiple app instances polling
//    concurrently never double-claim the same row.
//  - If Redis/BullMQ is temporarily unreachable, the enqueue throws, the
//    row goes back to PENDING with an exponential-backoff availableAt —
//    it is retried, never dropped. After MAX_ATTEMPTS it's parked as
//    FAILED (needs operator attention) but the row itself still exists.
//  - If this process crashes after claiming (status=PROCESSING) but
//    before the enqueue completes, the row is stuck at most
//    STUCK_PROCESSING_MS before the next poll (from this or another
//    instance) reclaims it.
//  - An event type with no queue mapping yet (see event-queue-map.ts)
//    is left PENDING, not FAILED — "no consumer implemented yet" is
//    expected, ongoing project scope, not a failure.
//
// What this does NOT provide: exactly-once delivery. A crash between a
// successful BullMQ enqueue and the PUBLISHED write being committed
// means the event is republished on the next poll — that's why every
// consumer must be idempotent (see infrastructure/idempotency). This is
// at-least-once delivery, by design.
@Injectable()
export class OutboxPublisherService implements OnModuleInit, OnModuleDestroy {
  private readonly logger = new Logger(OutboxPublisherService.name);
  private timer?: NodeJS.Timeout;
  private polling = false;

  constructor(
    private readonly prisma: PrismaService,
    private readonly queueService: QueueService,
    private readonly correlationIdService: CorrelationIdService,
    private readonly metrics: MetricsService,
  ) {}

  onModuleInit(): void {
    this.timer = setInterval(() => {
      void this.pollOnce();
    }, POLL_INTERVAL_MS);
  }

  onModuleDestroy(): void {
    if (this.timer) {
      clearInterval(this.timer);
    }
  }

  // Exposed for tests / manual triggering — the interval above just
  // calls this on a schedule.
  async pollOnce(): Promise<void> {
    if (this.polling) {
      return; // previous poll still running (e.g. slow queue) — skip this tick
    }
    this.polling = true;
    try {
      const claimed = await this.claimBatch();
      for (const event of claimed) {
        // Each event is relayed inside ITS OWN correlation context — the
        // id the originating business transaction stored on the row.
        // The poll loop itself belongs to no single operation, so
        // without this every publisher log would be uncorrelated and the
        // trace would show a gap exactly at the DB -> queue hop.
        await this.correlationIdService.run(event.correlationId, () =>
          this.publishOne(event),
        );
      }
    } catch (err) {
      this.logger.error({ event: 'outbox.poll_failed', error: err });
    } finally {
      this.polling = false;
    }
  }

  private claimBatch(): Promise<ClaimedOutboxEventRow[]> {
    return this.prisma.$queryRaw<ClaimedOutboxEventRow[]>(Prisma.sql`
      UPDATE "OutboxEvent"
      SET status = 'PROCESSING', "updatedAt" = now()
      WHERE id IN (
        SELECT id FROM "OutboxEvent"
        WHERE (status = 'PENDING' AND "availableAt" <= now())
           OR (status = 'PROCESSING' AND "updatedAt" < now() - (${STUCK_PROCESSING_MS} * interval '1 millisecond'))
        ORDER BY "createdAt" ASC
        LIMIT ${CLAIM_BATCH_SIZE}
        FOR UPDATE SKIP LOCKED
      )
      RETURNING id, "aggregateType", "aggregateId", "eventType", payload, "correlationId", attempts
    `);
  }

  private async publishOne(event: ClaimedOutboxEventRow): Promise<void> {
    const queueNames = resolveQueuesForEventType(event.eventType);
    if (queueNames.length === 0) {
      // Deliberately NOT marked FAILED: this project explicitly records
      // outbox events for types that don't have a consumer implemented
      // yet ("do not implement all consumers yet" is stated project
      // scope, not an oversight — see event-queue-map.ts). FAILED would
      // misrepresent that as broken. Left PENDING with a long
      // availableAt so it's naturally picked up once a mapping/consumer
      // is added later — no backfill/replay needed, which is exactly
      // the point of recording the event now. Still logged at WARN
      // (not silently) so a genuine typo in an event type is
      // discoverable.
      this.logger.warn({
        event: 'outbox.event_unmapped',
        eventId: event.id,
        eventType: event.eventType,
        entityType: event.aggregateType,
        entityId: event.aggregateId,
        recheckInMs: UNMAPPED_EVENT_RECHECK_MS,
        message: `No consumer queue mapped yet for "${event.eventType}" — leaving PENDING`,
      });
      await this.prisma.outboxEvent.update({
        where: { id: event.id },
        data: {
          status: OutboxEventStatus.PENDING,
          availableAt: new Date(Date.now() + UNMAPPED_EVENT_RECHECK_MS),
        },
      });
      return;
    }

    try {
      // Fan-out events (see event-queue-map.ts) enqueue to every mapped
      // queue; jobId: eventId on each makes a retry after a PARTIAL
      // failure here safe — a queue that already got the job treats a
      // second add() as a no-op, so this can be re-run wholesale.
      await Promise.all(
        queueNames.map((queueName) =>
          this.queueService.enqueueDomainEvent(queueName, {
            eventId: event.id,
            eventType: event.eventType,
            aggregateType: event.aggregateType,
            aggregateId: event.aggregateId,
            correlationId: event.correlationId,
            payload: event.payload,
          }),
        ),
      );
      // Only reachable once EVERY mapped queue's enqueue above has
      // actually resolved — never mark PUBLISHED optimistically or
      // partially.
      await this.prisma.outboxEvent.update({
        where: { id: event.id },
        data: { status: OutboxEventStatus.PUBLISHED, processedAt: new Date() },
      });
      this.metrics.recordOutboxPublished(event.eventType);
      this.logger.log({
        event: 'outbox.event_published',
        eventId: event.id,
        eventType: event.eventType,
        entityType: event.aggregateType,
        entityId: event.aggregateId,
        queues: queueNames,
      });
    } catch (err) {
      await this.handlePublishFailure(event, err);
    }
  }

  private async handlePublishFailure(
    event: ClaimedOutboxEventRow,
    err: unknown,
  ): Promise<void> {
    const attempts = event.attempts + 1;
    const message = err instanceof Error ? err.message : String(err);
    const exhausted = attempts >= MAX_ATTEMPTS;
    this.metrics.recordOutboxFailure(event.eventType);
    this.logger[exhausted ? 'error' : 'warn']({
      event: exhausted ? 'outbox.publish_exhausted' : 'outbox.publish_failed',
      eventId: event.id,
      eventType: event.eventType,
      entityType: event.aggregateType,
      entityId: event.aggregateId,
      attempt: attempts,
      maxAttempts: MAX_ATTEMPTS,
      error: err,
    });

    if (exhausted) {
      await this.prisma.outboxEvent.update({
        where: { id: event.id },
        data: {
          status: OutboxEventStatus.FAILED,
          attempts,
          lastError: message,
        },
      });
      return;
    }

    await this.prisma.outboxEvent.update({
      where: { id: event.id },
      data: {
        status: OutboxEventStatus.PENDING,
        attempts,
        lastError: message,
        availableAt: new Date(Date.now() + computeBackoffMs(attempts)),
      },
    });
  }
}
