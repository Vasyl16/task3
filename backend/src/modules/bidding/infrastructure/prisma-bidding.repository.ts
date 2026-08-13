import { Injectable } from '@nestjs/common';
import type { Auction, AuctionStatus, Bid, Prisma } from '@prisma/client';
import { PrismaService } from '../../../infrastructure/prisma/prisma.service';
import {
  BiddingRepository,
  CreateAuctionInput,
} from '../domain/bidding.repository';

@Injectable()
export class PrismaBiddingRepository implements BiddingRepository {
  constructor(private readonly prisma: PrismaService) {}

  findAuctionById(id: string): Promise<Auction | null> {
    return this.prisma.auction.findUnique({ where: { id } });
  }

  findAuctions(filter?: {
    productId?: string;
    sellerId?: string;
  }): Promise<Auction[]> {
    return this.prisma.auction.findMany({
      where: {
        productId: filter?.productId,
        sellerId: filter?.sellerId,
      },
      orderBy: { endsAt: 'asc' },
    });
  }

  createAuction(data: CreateAuctionInput): Promise<Auction> {
    return this.prisma.auction.create({ data });
  }

  listBidsForAuction(auctionId: string): Promise<Bid[]> {
    return this.prisma.bid.findMany({
      where: { auctionId },
      orderBy: { amount: 'desc' },
    });
  }

  async tryAcceptBid(
    tx: Prisma.TransactionClient,
    input: {
      auctionId: string;
      expectedVersion: number;
      bidderId: string;
      amount: number;
    },
  ): Promise<Bid | null> {
    const result = await tx.auction.updateMany({
      where: { id: input.auctionId, version: input.expectedVersion },
      data: {
        currentHighestBid: input.amount,
        currentHighestBidderId: input.bidderId,
        version: { increment: 1 },
      },
    });
    if (result.count === 0) {
      return null;
    }
    return tx.bid.create({
      data: {
        auctionId: input.auctionId,
        bidderId: input.bidderId,
        amount: input.amount,
      },
    });
  }

  async transitionStatusIfCurrent(
    tx: Prisma.TransactionClient,
    id: string,
    expectedCurrent: AuctionStatus,
    next: AuctionStatus,
    extra?: Partial<{ checkoutDeadline: Date | null }>,
  ): Promise<Auction | null> {
    const result = await tx.auction.updateMany({
      where: { id, status: expectedCurrent },
      data: { status: next, ...extra },
    });
    if (result.count === 0) {
      return null;
    }
    return tx.auction.findUniqueOrThrow({ where: { id } });
  }
}
