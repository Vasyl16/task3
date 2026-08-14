import { Injectable, Logger } from '@nestjs/common';
import { InjectQueue } from '@nestjs/bullmq';
import type { Queue } from 'bullmq';
import type { DomainEventJob } from './domain-event-job.interface';
import { QueueName } from './queue.constants';

// The only place in the app that talks to BullMQ directly for producing
// jobs — business services never import bullmq; they call
// OutboxService.record() inside their transaction, and the Outbox
// Publisher is the sole caller of enqueueDomainEvent below. This keeps
// queue/infrastructure details out of domain business logic.
@Injectable()
export class QueueService {
  private readonly logger = new Logger(QueueService.name);
  private readonly queues: Record<QueueName, Queue>;

  constructor(
    @InjectQueue(QueueName.SEARCH_SYNC) searchSync: Queue,
    @InjectQueue(QueueName.ORDER_PROCESSING) orderProcessing: Queue,
    @InjectQueue(QueueName.NOTIFICATIONS) notifications: Queue,
    @InjectQueue(QueueName.ANALYTICS) analytics: Queue,
    @InjectQueue(QueueName.AUCTION_DEADLINES) auctionDeadlines: Queue,
    @InjectQueue(QueueName.REALTIME) realtime: Queue,
    @InjectQueue(QueueName.EMAIL) email: Queue,
    @InjectQueue(QueueName.PAYMENTS) payments: Queue,
  ) {
    this.queues = {
      [QueueName.SEARCH_SYNC]: searchSync,
      [QueueName.ORDER_PROCESSING]: orderProcessing,
      [QueueName.NOTIFICATIONS]: notifications,
      [QueueName.ANALYTICS]: analytics,
      [QueueName.AUCTION_DEADLINES]: auctionDeadlines,
      [QueueName.REALTIME]: realtime,
      [QueueName.EMAIL]: email,
      [QueueName.PAYMENTS]: payments,
    };
  }

  // Resolves only once the job is durably written to Redis (queue.add()
  // awaits the underlying command) — the Outbox Publisher relies on that
  // to decide whether it's safe to mark the OutboxEvent PUBLISHED.
  //
  // jobId: eventId gives a second, queue-level idempotency layer on top
  // of the DB-level ProcessedEvent guard consumers use: BullMQ treats
  // adding a job with an id that's still present (not yet removed) as a
  // no-op, so a publisher retry after a network blip that actually did
  // enqueue doesn't create a duplicate job.
  async enqueueDomainEvent(
    queueName: QueueName,
    job: DomainEventJob,
  ): Promise<void> {
    const queue = this.queues[queueName];
    await queue.add(job.eventType, job, {
      jobId: job.eventId,
      attempts: 5,
      backoff: { type: 'exponential', delay: 2000 },
      removeOnComplete: { count: 1000 },
      removeOnFail: false,
    });
    this.logger.log({
      msg: 'domain event enqueued',
      queue: queueName,
      eventId: job.eventId,
      eventType: job.eventType,
      correlationId: job.correlationId,
    });
  }

  // Distinct from enqueueDomainEvent: this schedules a job for a FUTURE
  // point in time (e.g. an auction's deadline), not a reliable-delivery
  // relay of something that already happened. It is NOT part of the
  // outbox pattern — there's no OutboxEvent row backing it, so it's
  // scheduled directly by the caller (see BiddingService.createAuction)
  // rather than via the Outbox Publisher.
  //
  // Best-effort and bounded, by design: if Redis is unreachable, ioredis
  // buffers the command and waits for a connection rather than failing
  // fast (its default "offline queue" behavior) — awaited without a
  // bound, that would hang the HTTP request that triggered scheduling
  // (e.g. POST /auctions) for as long as Redis stays down. This method
  // times out instead, logs a warning, and returns normally — the
  // caller's own write (e.g. the Auction row) is never held hostage by
  // queue availability. This is why callers MUST NOT treat this as the
  // only mechanism: BiddingModule also runs
  // AuctionDeadlineSweeperService, a periodic poll against Postgres
  // (the source of truth for `endsAt`/`checkoutDeadline`) that reaches
  // the same idempotent, guarded transitions independently — the fast
  // path is this scheduled job firing near-exactly on time; the sweep is
  // the reliability backstop when it doesn't (Redis down at schedule
  // time, or a job lost to a Redis flush).
  async scheduleDelayed(
    queueName: QueueName,
    jobName: string,
    data: Record<string, unknown>,
    runAt: Date,
  ): Promise<void> {
    const delay = Math.max(0, runAt.getTime() - Date.now());
    const queue = this.queues[queueName];
    try {
      await Promise.race([
        queue.add(jobName, data, {
          delay,
          attempts: 5,
          backoff: { type: 'exponential', delay: 2000 },
          removeOnComplete: { count: 1000 },
          removeOnFail: false,
        }),
        new Promise<never>((_, reject) =>
          setTimeout(
            () => reject(new Error('scheduleDelayed timed out after 5000ms')),
            5000,
          ),
        ),
      ]);
      this.logger.log({
        msg: 'delayed job scheduled',
        queue: queueName,
        jobName,
        delayMs: delay,
        runAt: runAt.toISOString(),
      });
    } catch (err) {
      this.logger.warn(
        `Could not schedule delayed job "${jobName}" on ${queueName} (will rely on periodic reconciliation instead): ${(err as Error).message}`,
      );
    }
  }
}
