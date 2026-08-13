import {
  BadRequestException,
  ConflictException,
  ForbiddenException,
  Injectable,
  Logger,
  NotFoundException,
} from '@nestjs/common';
import {
  AuctionStatus,
  ProductType,
  type Auction,
  type Bid,
  type Prisma,
} from '@prisma/client';
import { randomUUID } from 'node:crypto';
import { CorrelationIdService } from '../../core/correlation-id/correlation-id.service';
import { PrismaService } from '../../infrastructure/prisma/prisma.service';
import { OutboxService } from '../../infrastructure/outbox/outbox.service';
import { QueueService } from '../../infrastructure/queue/queue.service';
import { MetricsService } from '../../infrastructure/metrics/metrics.service';
import { QueueName } from '../../infrastructure/queue/queue.constants';
import { ProductsService } from '../products/products.service';
import { SellersService } from '../sellers/sellers.service';
import { BiddingRepository } from './domain/bidding.repository';
import { CreateAuctionDto } from './dto/create-auction.dto';
import { PlaceBidDto } from './dto/place-bid.dto';
import { BID_PLACED_EVENT } from './domain/events/bid-placed.event';
import { AUCTION_ENDED_EVENT } from './domain/events/auction-ended.event';

// Bounded retry — bid placement is cheap to retry (a single conditional
// UPDATE), so a genuine collision costs at most a couple of extra
// round-trips rather than a hard failure the client has to handle.
const MAX_BID_ATTEMPTS = 3;
// How long a winner has to complete checkout after the auction ends
// before the win expires — see expireCheckoutWindowIfUnclaimed.
const WINNER_CHECKOUT_WINDOW_MS = 48 * 60 * 60 * 1000;

export const START_AUCTION_JOB = 'start-auction';
export const END_AUCTION_JOB = 'end-auction';
export const EXPIRE_CHECKOUT_WINDOW_JOB = 'expire-checkout-window';

@Injectable()
export class BiddingService {
  private readonly logger = new Logger(BiddingService.name);

  constructor(
    private readonly biddingRepository: BiddingRepository,
    private readonly productsService: ProductsService,
    private readonly sellersService: SellersService,
    private readonly outboxService: OutboxService,
    private readonly queueService: QueueService,
    private readonly correlationIdService: CorrelationIdService,
    private readonly metrics: MetricsService,
    private readonly prisma: PrismaService,
  ) {}

  findAuctions(filter?: {
    productId?: string;
    sellerId?: string;
  }): Promise<Auction[]> {
    return this.biddingRepository.findAuctions(filter);
  }

  async findAuctionById(id: string): Promise<Auction> {
    const auction = await this.biddingRepository.findAuctionById(id);
    if (!auction) {
      throw new NotFoundException(`Auction ${id} not found`);
    }
    return auction;
  }

  // sellerId is NEVER taken from the request — derived from the caller's
  // own approved SellerProfile, then cross-checked against the product's
  // actual owner (same IDOR-prevention shape as ProductsService.create).
  // Deadline processing is scheduled here, as BullMQ delayed jobs fired
  // at startsAt/endsAt — see QueueService.scheduleDelayed and
  // AuctionDeadlineConsumer. An auction whose startsAt has already
  // passed (or wasn't given a future one) starts ACTIVE immediately,
  // with no job needed for that transition.
  async createAuction(
    callerId: string,
    dto: CreateAuctionDto,
  ): Promise<Auction> {
    const sellerProfile =
      await this.sellersService.getOwnApprovedSellerProfileOrThrow(callerId);
    const product = await this.productsService.findById(dto.productId); // 404s if missing
    if (product.sellerId !== sellerProfile.id) {
      throw new ForbiddenException('You do not own this product');
    }
    if (product.type !== ProductType.AUCTION) {
      throw new BadRequestException(
        'An auction can only be created for an AUCTION-type product',
      );
    }

    const startsAt = new Date(dto.startsAt);
    const endsAt = new Date(dto.endsAt);
    const startsImmediately = startsAt <= new Date();
    const auction = await this.biddingRepository.createAuction({
      productId: dto.productId,
      sellerId: sellerProfile.id,
      startingPrice: dto.startingPrice,
      minBidIncrement: dto.minBidIncrement,
      startsAt,
      endsAt,
      status: startsImmediately
        ? AuctionStatus.ACTIVE
        : AuctionStatus.SCHEDULED,
    });

    if (!startsImmediately) {
      await this.queueService.scheduleDelayed(
        QueueName.AUCTION_DEADLINES,
        START_AUCTION_JOB,
        { auctionId: auction.id },
        startsAt,
      );
    }
    await this.queueService.scheduleDelayed(
      QueueName.AUCTION_DEADLINES,
      END_AUCTION_JOB,
      { auctionId: auction.id },
      endsAt,
    );

    return auction;
  }

  listBids(auctionId: string): Promise<Bid[]> {
    return this.biddingRepository.listBidsForAuction(auctionId);
  }

  // THE concurrency-critical operation. Strategy: OPTIMISTIC locking via
  // Auction.version, not pessimistic row locking (SELECT ... FOR UPDATE)
  // — chosen because:
  //   - Bid placement is a short, fast write; the common case (no other
  //     bidder colliding on this exact auction at this exact instant)
  //     pays zero locking overhead, whereas a pessimistic lock would
  //     serialize EVERY bid attempt through a single lock even when
  //     there's no actual conflict.
  //   - A popular auction can have many concurrent READERS (checking the
  //     current price) alongside occasional colliding writers — nothing
  //     here needs to block reads.
  //   - The conditional UPDATE ... WHERE version = ? IS the safety
  //     property, not an afterthought: Postgres serializes two
  //     concurrent UPDATEs to the same row, so the loser's WHERE clause
  //     re-evaluates against the winner's already-committed version and
  //     matches 0 rows — it can never silently overwrite the winner's
  //     bid (no lost update). That failure is detected (tryAcceptBid
  //     returns null) and retried against freshly re-read state, up to
  //     MAX_BID_ATTEMPTS times, giving both bidders a fair shot instead
  //     of hard-failing whichever request's network round-trip happened
  //     to land microseconds later.
  async placeBid(
    auctionId: string,
    callerId: string,
    dto: PlaceBidDto,
  ): Promise<Bid> {
    const correlationId = this.correlationIdService.getId() ?? randomUUID();

    for (let attempt = 0; attempt < MAX_BID_ATTEMPTS; attempt++) {
      const auction = await this.findAuctionById(auctionId); // 404s if missing
      this.assertAcceptingBids(auction);

      const minAcceptable = this.computeMinAcceptableBid(auction);
      if (dto.amount < minAcceptable) {
        this.metrics.recordBid('rejected');
        throw new BadRequestException(
          `Bid must be at least ${minAcceptable.toFixed(2)}`,
        );
      }

      const accepted = await this.prisma.$transaction(async (tx) => {
        const bid = await this.biddingRepository.tryAcceptBid(tx, {
          auctionId,
          expectedVersion: auction.version,
          bidderId: callerId,
          amount: dto.amount,
        });
        if (!bid) {
          return null;
        }
        await this.outboxService.record(tx, {
          aggregateType: 'Auction',
          aggregateId: auctionId,
          eventType: BID_PLACED_EVENT,
          payload: {
            auctionId,
            bidId: bid.id,
            bidderId: callerId,
            amount: dto.amount,
          },
          correlationId,
        });
        return bid;
      });

      if (accepted) {
        this.metrics.recordBid('accepted');
        this.logger.log({
          event: 'bid.accepted',
          userId: callerId,
          entityType: 'Auction',
          entityId: auctionId,
          bidId: accepted.id,
          amount: dto.amount,
          attempt: attempt + 1,
        });
        return accepted;
      }
      // version mismatch — someone else's bid landed first between our
      // read and our write; loop and re-validate against fresh state
      // (their bid may have raised the minimum acceptable amount).
      // Counted so contention on the optimistic-locking strategy is
      // observable rather than invisible.
      this.metrics.recordBidVersionConflict();
    }

    this.metrics.recordBid('conflict');
    this.logger.warn({
      event: 'bid.conflict_exhausted',
      userId: callerId,
      entityType: 'Auction',
      entityId: auctionId,
      attempts: MAX_BID_ATTEMPTS,
    });
    throw new ConflictException(
      'Could not place bid due to concurrent updates — please retry',
    );
  }

  private assertAcceptingBids(auction: Auction): void {
    if (auction.status !== AuctionStatus.ACTIVE) {
      this.metrics.recordBid('rejected');
      throw new BadRequestException('This auction is not accepting bids');
    }
    if (new Date() >= auction.endsAt) {
      this.metrics.recordBid('rejected');
      throw new BadRequestException('This auction has ended');
    }
  }

  private computeMinAcceptableBid(auction: Auction): number {
    return auction.currentHighestBid
      ? Number(auction.currentHighestBid) + Number(auction.minBidIncrement)
      : Number(auction.startingPrice);
  }

  // ===================== Deadline processing =====================
  // All three are called by AuctionDeadlineConsumer, from the BullMQ
  // delayed jobs scheduled in createAuction/endAuction — never from the
  // outbox (these fire at a future point in time, not in reaction to
  // something that already happened, so the outbox pattern doesn't apply
  // here). Each is idempotent by construction via
  // transitionStatusIfCurrent's conditional (status-guarded) update — a
  // redelivered job that finds the auction already moved on is a
  // harmless no-op. AuctionDeadlineSweeperService calls the same methods
  // on a periodic poll as the reliability backstop.

  async activateAuctionIfDue(auctionId: string): Promise<void> {
    await this.prisma.$transaction((tx) =>
      this.biddingRepository.transitionStatusIfCurrent(
        tx,
        auctionId,
        AuctionStatus.SCHEDULED,
        AuctionStatus.ACTIVE,
      ),
    );
  }

  async endAuction(auctionId: string): Promise<void> {
    const auction = await this.biddingRepository.findAuctionById(auctionId);
    if (!auction) {
      return;
    }

    // Inherit the caller's context (the deadline consumer or sweeper
    // minted one for this operation) — only fall back to a new id if
    // somehow invoked outside any. Minting unconditionally here would
    // detach the AuctionEnded event, and everything downstream of it,
    // from the job that actually caused it.
    const correlationId = this.correlationIdService.getId() ?? randomUUID();
    const hasWinner = auction.currentHighestBidderId !== null;
    const nextStatus = hasWinner ? AuctionStatus.ENDED : AuctionStatus.EXPIRED;
    const checkoutDeadline = hasWinner
      ? new Date(Date.now() + WINNER_CHECKOUT_WINDOW_MS)
      : null;

    const updated = await this.prisma.$transaction(async (tx) => {
      const result = await this.biddingRepository.transitionStatusIfCurrent(
        tx,
        auctionId,
        AuctionStatus.ACTIVE,
        nextStatus,
        { checkoutDeadline },
      );
      if (!result) {
        return null;
      }
      await this.outboxService.record(tx, {
        aggregateType: 'Auction',
        aggregateId: auctionId,
        eventType: AUCTION_ENDED_EVENT,
        payload: {
          auctionId,
          winningBidderId: auction.currentHighestBidderId,
          winningAmount: auction.currentHighestBid?.toString() ?? null,
        },
        correlationId,
      });
      return result;
    });

    if (updated) {
      this.metrics.recordAuctionEnded(hasWinner ? 'with_winner' : 'no_bids');
      this.logger.log({
        event: 'auction.ended',
        entityType: 'Auction',
        entityId: auctionId,
        outcome: hasWinner ? 'with_winner' : 'no_bids',
        winningBidderId: auction.currentHighestBidderId,
      });
    }

    if (updated && hasWinner && checkoutDeadline) {
      await this.queueService.scheduleDelayed(
        QueueName.AUCTION_DEADLINES,
        EXPIRE_CHECKOUT_WINDOW_JOB,
        { auctionId },
        checkoutDeadline,
      );
    }
  }

  async expireCheckoutWindowIfUnclaimed(auctionId: string): Promise<void> {
    await this.prisma.$transaction((tx) =>
      this.biddingRepository.transitionStatusIfCurrent(
        tx,
        auctionId,
        AuctionStatus.ENDED,
        AuctionStatus.EXPIRED,
      ),
    );
  }

  // ===================== Winner checkout support =====================
  // Called by OrdersService.checkoutAuctionWin (orders imports bidding,
  // never the reverse — see the backend-architecture skill).

  assertCanCheckoutAsWinner(auction: Auction, callerId: string): void {
    if (auction.status !== AuctionStatus.ENDED) {
      throw new BadRequestException(
        'This auction has no completed win awaiting checkout',
      );
    }
    if (auction.currentHighestBidderId !== callerId) {
      throw new ForbiddenException('You are not the winner of this auction');
    }
    if (!auction.checkoutDeadline || new Date() > auction.checkoutDeadline) {
      throw new BadRequestException(
        'The checkout window for this auction win has expired',
      );
    }
  }

  async markAuctionCompleted(
    tx: Prisma.TransactionClient,
    auctionId: string,
  ): Promise<void> {
    await this.biddingRepository.transitionStatusIfCurrent(
      tx,
      auctionId,
      AuctionStatus.ENDED,
      AuctionStatus.COMPLETED,
    );
  }
}
