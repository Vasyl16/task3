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
  // Who is winning is deliberately NOT sent to clients — see the
  // backend's PublicAuction projection. This is the per-caller answer
  // instead: true only when the signed-in viewer holds the top bid.
  // Always false for anonymous visitors.
  viewerIsHighestBidder: boolean;
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
  amount: string;
  placedAt: string;
  // Whether this row is the viewer's own bid. The bidder's identity is
  // never returned, so this is the only thing a client can know about
  // who placed what — and the only thing it needs.
  isMine: boolean;
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
