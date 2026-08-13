import type { Job } from 'bullmq';
import { CorrelationIdService } from '../../core/correlation-id/correlation-id.service';
import { MetricsService } from '../metrics/metrics.service';
import type { DomainEventJob } from './domain-event-job.interface';
import { DomainEventConsumer } from './domain-event.consumer';

function buildJob(correlationId: string): Job<DomainEventJob> {
  return {
    data: {
      eventId: 'event-1',
      eventType: 'SomethingHappened',
      aggregateType: 'Thing',
      aggregateId: 'thing-1',
      correlationId,
      payload: {},
    },
    attemptsMade: 0,
  } as Job<DomainEventJob>;
}

class TestConsumer extends DomainEventConsumer {
  seenInsideHandler: string | undefined;
  shouldThrow = false;

  constructor(
    private readonly correlation: CorrelationIdService,
    metrics: MetricsService,
  ) {
    super(correlation, metrics, 'test-queue');
  }

  protected async handleEvent(): Promise<void> {
    // Read AFTER an await, to prove the context survives the boundary
    // and not just the synchronous entry.
    await Promise.resolve();
    this.seenInsideHandler = this.correlation.getId();
    if (this.shouldThrow) {
      throw new Error('handler blew up');
    }
  }
}

// This is the requirement "workers must include the same correlationId"
// and "do not generate a new correlation ID for every async step",
// asserted directly: the id the handler observes must be the id that
// travelled on the job, unchanged.
describe('DomainEventConsumer', () => {
  let correlation: CorrelationIdService;
  let metrics: MetricsService;
  let consumer: TestConsumer;

  beforeEach(() => {
    correlation = new CorrelationIdService();
    metrics = new MetricsService();
    consumer = new TestConsumer(correlation, metrics);
  });

  it('runs the handler inside the correlation context carried on the job', async () => {
    await consumer.process(buildJob('corr-from-http'));

    expect(consumer.seenInsideHandler).toBe('corr-from-http');
  });

  it('reuses the job’s id rather than generating a fresh one per hop', async () => {
    await consumer.process(buildJob('corr-original'));
    const first = consumer.seenInsideHandler;

    await consumer.process(buildJob('corr-original'));

    expect(first).toBe('corr-original');
    expect(consumer.seenInsideHandler).toBe('corr-original');
  });

  it('leaves no ambient context behind after the job finishes', async () => {
    await consumer.process(buildJob('corr-scoped'));

    expect(correlation.getId()).toBeUndefined();
  });

  it('records a completed queue job metric', async () => {
    await consumer.process(buildJob('corr-1'));

    const rendered = await metrics.render();
    expect(rendered).toContain(
      'queue_jobs_total{queue="test-queue",result="completed"} 1',
    );
  });

  // BullMQ needs the rejection to trigger its retry/backoff, so the
  // metric must not swallow it.
  it('records a failed job metric and still rethrows', async () => {
    consumer.shouldThrow = true;

    await expect(consumer.process(buildJob('corr-1'))).rejects.toThrow(
      'handler blew up',
    );

    const rendered = await metrics.render();
    expect(rendered).toContain(
      'queue_jobs_total{queue="test-queue",result="failed"} 1',
    );
  });
});
