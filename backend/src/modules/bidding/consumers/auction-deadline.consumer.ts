import { Injectable, Logger } from '@nestjs/common';
import { OnWorkerEvent, Processor, WorkerHost } from '@nestjs/bullmq';
import type { Job } from 'bullmq';
import { randomUUID } from 'node:crypto';
import { CorrelationIdService } from '../../../core/correlation-id/correlation-id.service';
import { QueueName } from '../../../infrastructure/queue/queue.constants';
import {
  BiddingService,
  END_AUCTION_JOB,
  EXPIRE_CHECKOUT_WINDOW_JOB,
  START_AUCTION_JOB,
} from '../bidding.service';

interface AuctionDeadlineJob {
  auctionId: string;
}

// Consumes the delayed jobs BiddingService schedules directly (NOT via
// the outbox — see BiddingService's "Deadline processing" section for
// why: these fire at a future point in time, not in reaction to a fact
// that already happened). Both handlers are idempotent by construction
// via BiddingService's status-guarded transitions, so BullMQ redelivery
// (e.g. after a worker crash mid-job) is always safe to just re-run.
@Injectable()
@Processor(QueueName.AUCTION_DEADLINES)
export class AuctionDeadlineConsumer extends WorkerHost {
  private readonly logger = new Logger(AuctionDeadlineConsumer.name);

  constructor(
    private readonly biddingService: BiddingService,
    private readonly correlationIdService: CorrelationIdService,
  ) {
    super();
  }

  // Unlike DomainEventConsumer, this MINTS a correlation id instead of
  // resuming one — and that is the correct call here. A deadline job is
  // not the continuation of some earlier request: nobody asked for it,
  // it fires because wall-clock time passed. Reviving the id of the
  // request that created the auction days earlier would splice two
  // unrelated operations into one trace. What matters is that the id is
  // minted ONCE at this boundary and then flows through everything the
  // handler touches, including any outbox events it records.
  process(job: Job<AuctionDeadlineJob>): Promise<void> {
    return this.correlationIdService.run(randomUUID(), () =>
      this.handleDeadline(job),
    );
  }

  private async handleDeadline(job: Job<AuctionDeadlineJob>): Promise<void> {
    this.logger.log({
      event: 'auction_deadline.job_started',
      jobName: job.name,
      entityType: 'Auction',
      entityId: job.data.auctionId,
    });
    if (job.name === START_AUCTION_JOB) {
      await this.biddingService.activateAuctionIfDue(job.data.auctionId);
      return;
    }
    if (job.name === END_AUCTION_JOB) {
      await this.biddingService.endAuction(job.data.auctionId);
      return;
    }
    if (job.name === EXPIRE_CHECKOUT_WINDOW_JOB) {
      await this.biddingService.expireCheckoutWindowIfUnclaimed(
        job.data.auctionId,
      );
      return;
    }
    this.logger.warn({
      event: 'auction_deadline.unhandled_job',
      jobName: job.name,
      entityType: 'Auction',
      entityId: job.data.auctionId,
    });
  }

  @OnWorkerEvent('failed')
  onFailed(job: Job<AuctionDeadlineJob> | undefined, err: Error): void {
    this.logger.error({
      event: 'auction_deadline.job_failed',
      jobName: job?.name,
      entityType: 'Auction',
      entityId: job?.data.auctionId,
      jobAttempt: job?.attemptsMade,
      error: err,
    });
  }
}
