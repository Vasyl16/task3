import type { Auction, AuctionStatus, Bid, Prisma } from '@prisma/client';

export interface CreateAuctionInput {
  productId: string;
  sellerId: string;
  quantity: number;
  startingPrice: number;
  minBidIncrement: number;
  startsAt: Date;
  endsAt: Date;
  // Computed by BiddingService (ACTIVE if startsAt has already passed,
  // SCHEDULED otherwise) — the repository just persists it, matching
  // this codebase's convention of business decisions in the service.
  status: AuctionStatus;
}

export abstract class BiddingRepository {
  abstract findAuctionById(id: string): Promise<Auction | null>;
  abstract findAuctions(filter?: {
    productId?: string;
    sellerId?: string;
  }): Promise<Auction[]>;
  // Every auction the given user has placed at least one bid on —
  // "won or lost", not just currently-winning, so a buyer's history page
  // doesn't lose an auction the moment someone outbids them.
  abstract findAuctionsForBidder(bidderId: string): Promise<Auction[]>;
  // Takes tx (unlike findAuctions/findAuctionById) — BiddingService
  // writes the auction and its "product became biddable" outbox event
  // in the same transaction, so search-sync can never observe one
  // without the other.
  abstract createAuction(
    tx: Prisma.TransactionClient,
    data: CreateAuctionInput,
  ): Promise<Auction>;
  abstract listBidsForAuction(auctionId: string): Promise<Bid[]>;

  // THE concurrency-critical write. Optimistic locking: succeeds only if
  // the row's version still matches expectedVersion (see
  // BiddingService.placeBid for why this strategy, and the retry loop
  // around it). Returns null (not an error) on a version mismatch — the
  // caller re-reads and retries against fresh state.
  abstract tryAcceptBid(
    tx: Prisma.TransactionClient,
    input: {
      auctionId: string;
      expectedVersion: number;
      bidderId: string;
      amount: number;
    },
  ): Promise<Bid | null>;

  // Guarded, idempotent-by-construction status transition used by the
  // deadline/expiry BullMQ jobs (see AuctionDeadlineConsumer) — succeeds
  // only if the row is still in `expectedCurrent`; a redelivered job that
  // finds it already moved on is a harmless no-op (returns null).
  abstract transitionStatusIfCurrent(
    tx: Prisma.TransactionClient,
    id: string,
    expectedCurrent: AuctionStatus,
    next: AuctionStatus,
    extra?: Partial<{ checkoutDeadline: Date | null }>,
  ): Promise<Auction | null>;
}
