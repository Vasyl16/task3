import { WorkerHost } from '@nestjs/bullmq';
import type { Job } from 'bullmq';
import { CorrelationIdService } from '../../core/correlation-id/correlation-id.service';
import { MetricsService } from '../metrics/metrics.service';
import type { DomainEventJob } from './domain-event-job.interface';

// Base for every consumer driven by an OutboxEvent. It owns the two
// cross-cutting concerns no handler should have to remember: re-entering
// the originating correlation context, and timing the job.
//
// The correlation part is the link that makes the trace unbroken.
// AsyncLocalStorage does not survive a hop through Redis: by the time a
// worker picks up a job, the HTTP request that caused it is long gone
// and its ALS store with it. The id survives only because it was written
// onto the OutboxEvent row inside the business transaction, relayed into
// the BullMQ job payload, and re-established here. Everything the
// handler logs — at any depth, through any number of awaits — therefore
// carries the SAME correlationId the original HTTP request had.
//
// It deliberately re-uses job.data.correlationId rather than generating
// one. A worker is a continuation of an operation that already started,
// not a new operation; minting a fresh id here would sever the trace at
// exactly the point it becomes most useful. (Contrast
// AuctionDeadlineConsumer, which is genuinely self-initiated and so
// mints its own — see the comment there.)
export abstract class DomainEventConsumer extends WorkerHost {
  protected constructor(
    private readonly correlationIdService: CorrelationIdService,
    private readonly metricsService: MetricsService,
    // The queue this consumer serves, used as a metric label. Passed
    // explicitly rather than read off the @Processor decorator so it
    // can't silently disagree with it.
    private readonly queueName: string,
  ) {
    super();
  }

  async process(job: Job<DomainEventJob>): Promise<void> {
    const startedAt = process.hrtime.bigint();
    try {
      await this.correlationIdService.run(job.data.correlationId, () =>
        this.handleEvent(job),
      );
      this.record('completed', startedAt);
    } catch (err) {
      // Recorded and rethrown: BullMQ still needs the rejection to
      // trigger its retry/backoff.
      this.record('failed', startedAt);
      throw err;
    }
  }

  private record(result: 'completed' | 'failed', startedAt: bigint): void {
    const seconds = Number(process.hrtime.bigint() - startedAt) / 1e9;
    this.metricsService.recordQueueJob(this.queueName, result, seconds);
  }

  // Implemented instead of process(). Anything logged in here is already
  // inside the correlation context — do not re-read or re-pass the id.
  protected abstract handleEvent(job: Job<DomainEventJob>): Promise<void>;
}
