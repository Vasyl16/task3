export const AUCTION_ENDED_EVENT = 'AuctionEnded';

export interface AuctionEndedEvent {
  auctionId: string;
  winningBidderId: string | null;
  winningAmount: string | null;
}
