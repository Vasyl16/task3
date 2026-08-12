import type { Auction, Bid } from '@prisma/client';

export abstract class BiddingRepository {
  abstract findAuctionById(id: string): Promise<Auction | null>;
  abstract findAuctions(filter?: {
    productId?: string;
    sellerId?: string;
  }): Promise<Auction[]>;
  abstract createAuction(data: {
    productId: string;
    sellerId: string;
    startingPrice: number;
    startsAt: Date;
    endsAt: Date;
  }): Promise<Auction>;
  abstract listBidsForAuction(auctionId: string): Promise<Bid[]>;
}
