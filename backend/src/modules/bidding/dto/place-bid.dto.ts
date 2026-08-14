import { IsNumber, Min } from 'class-validator';

// No bidderId field — the bidder is always the authenticated caller
// (@CurrentUser()), never a client-supplied value. See
// BiddingController.placeBid.
export class PlaceBidDto {
  // > 0 — a $0 bid is only reachable at all against a $0 starting price
  // (BiddingService still re-validates amount >= computeMinAcceptableBid
  // regardless), but there's no legitimate reason to ever accept one.
  @IsNumber({ maxDecimalPlaces: 2 })
  @Min(0.01)
  amount!: number;
}
