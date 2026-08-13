import {
  Injectable,
  Logger,
  OnModuleDestroy,
  OnModuleInit,
} from '@nestjs/common';
import { AuctionStatus } from '@prisma/client';
import { randomUUID } from 'node:crypto';
import { CorrelationIdService } from '../../core/correlation-id/correlation-id.service';
import { PrismaService } from '../../infrastructure/prisma/prisma.service';
import { BiddingService } from './bidding.service';

const SWEEP_INTERVAL_MS = 30_000;
const BATCH_SIZE = 50;

// The reliability backstop for auction deadline processing (see
// QueueService.scheduleDelayed's doc comment): the BullMQ delayed job
// scheduled at auction creation is the fast path, firing near-exactly at
// the deadline — but it depends on Redis having been reachable at
// schedule time and staying up (with the job intact) until then. This
// sweep polls Postgres directly (the actual source of truth for
// endsAt/checkoutDeadline) and drives the exact same idempotent,
// guarded transitions BiddingService already exposes, so it's always
// safe to run alongside the queued job — whichever gets there first
// wins; the other is a no-op. Mirrors OutboxPublisherService's own
// "poll Postgres, don't just trust the queue" philosophy.
@Injectable()
export class AuctionDeadlineSweeperService
  implements OnModuleInit, OnModuleDestroy
{
  private readonly logger = new Logger(AuctionDeadlineSweeperService.name);
  private timer?: NodeJS.Timeout;
  private sweeping = false;

  constructor(
    private readonly prisma: PrismaService,
    private readonly biddingService: BiddingService,
    private readonly correlationIdService: CorrelationIdService,
  ) {}

  onModuleInit(): void {
    this.timer = setInterval(() => {
      void this.sweepOnce();
    }, SWEEP_INTERVAL_MS);
  }

  onModuleDestroy(): void {
    if (this.timer) {
      clearInterval(this.timer);
    }
  }

  // One correlation id per SWEEP, minted here — a sweep is its own
  // self-initiated operation (same reasoning as
  // AuctionDeadlineConsumer). Scoping it to the whole sweep rather than
  // per-auction means one trace shows everything a single pass did,
  // which is what you actually want when asking "what did the 12:30
  // sweep touch?".
  sweepOnce(): Promise<void> {
    return this.correlationIdService.run(randomUUID(), () => this.runSweep());
  }

  private async runSweep(): Promise<void> {
    if (this.sweeping) {
      return;
    }
    this.sweeping = true;
    try {
      const overdueScheduled = await this.prisma.auction.findMany({
        where: {
          status: AuctionStatus.SCHEDULED,
          startsAt: { lte: new Date() },
        },
        select: { id: true },
        take: BATCH_SIZE,
      });
      for (const auction of overdueScheduled) {
        await this.biddingService.activateAuctionIfDue(auction.id);
      }

      const overdueActive = await this.prisma.auction.findMany({
        where: { status: AuctionStatus.ACTIVE, endsAt: { lte: new Date() } },
        select: { id: true },
        take: BATCH_SIZE,
      });
      for (const auction of overdueActive) {
        await this.biddingService.endAuction(auction.id);
      }

      const overdueCheckoutWindows = await this.prisma.auction.findMany({
        where: {
          status: AuctionStatus.ENDED,
          checkoutDeadline: { lte: new Date() },
        },
        select: { id: true },
        take: BATCH_SIZE,
      });
      for (const auction of overdueCheckoutWindows) {
        await this.biddingService.expireCheckoutWindowIfUnclaimed(auction.id);
      }
    } catch (err) {
      this.logger.error({ event: 'auction_deadline.sweep_failed', error: err });
    } finally {
      this.sweeping = false;
    }
  }
}
