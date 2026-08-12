import { Injectable } from '@nestjs/common';
import type { Auction, Bid } from '@prisma/client';
import { PrismaService } from '../../../infrastructure/prisma/prisma.service';
import { BiddingRepository } from '../domain/bidding.repository';

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

  createAuction(data: {
    productId: string;
    sellerId: string;
    startingPrice: number;
    startsAt: Date;
    endsAt: Date;
  }): Promise<Auction> {
    return this.prisma.auction.create({ data });
  }

  listBidsForAuction(auctionId: string): Promise<Bid[]> {
    return this.prisma.bid.findMany({
      where: { auctionId },
      orderBy: { amount: 'desc' },
    });
  }
}
