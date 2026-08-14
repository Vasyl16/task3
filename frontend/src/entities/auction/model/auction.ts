export type AuctionStatus =
  'SCHEDULED' | 'ACTIVE' | 'ENDED' | 'COMPLETED' | 'EXPIRED' | 'CANCELLED';

export interface Auction {
  id: string;
  productId: string;
  sellerId: string;
  // The lot size — awarded entirely to the single winning bidder, never
  // split across multiple winners. See backend Auction.quantity.
  quantity: number;
  startingPrice: string;
  minBidIncrement: string;
  currentHighestBid: string | null;
  currentHighestBidderId: string | null;
  status: AuctionStatus;
  version: number;
  startsAt: string;
  endsAt: string;
  checkoutDeadline: string | null;
  createdAt: string;
  updatedAt: string;
}

export interface Bid {
  id: string;
  auctionId: string;
  bidderId: string;
  amount: string;
  placedAt: string;
}

export interface ListAuctionsParams {
  productId?: string;
  sellerId?: string;
}

export interface CreateAuctionInput {
  productId: string;
  quantity: number;
  startingPrice: number;
  minBidIncrement: number;
  startsAt: string;
  endsAt: string;
}
