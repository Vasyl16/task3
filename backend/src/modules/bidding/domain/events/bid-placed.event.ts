export const BID_PLACED_EVENT = 'BidPlaced';

export interface BidPlacedEvent {
  auctionId: string;
  bidId: string;
  bidderId: string;
  amount: string;
}
