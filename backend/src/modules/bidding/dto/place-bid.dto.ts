import { IsNumber, Min } from 'class-validator';

// No bidderId field — the bidder is always the authenticated caller
// (@CurrentUser()), never a client-supplied value. See
// BiddingController.placeBid.
export class PlaceBidDto {
  @IsNumber({ maxDecimalPlaces: 2 })
  @Min(0)
  amount!: number;
}
