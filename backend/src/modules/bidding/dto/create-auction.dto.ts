import { IsDateString, IsInt, IsNumber, IsUUID, Min } from 'class-validator';

// No sellerId field — the owning seller is always derived from the
// authenticated caller's own (approved) SellerProfile, never a
// client-supplied value. Same pattern as CreateProductDto. See
// BiddingController.createAuction.
export class CreateAuctionDto {
  @IsUUID()
  productId!: string;

  // The lot size — awarded entirely to the single winning bidder.
  // BiddingService re-validates this against the product's currently
  // uncommitted stock (never trust a client-supplied quantity to
  // actually be available).
  @IsInt()
  @Min(1)
  quantity!: number;

  // > 0, not just >= 0 — a $0 starting price lets the very first bid
  // also be $0 (computeMinAcceptableBid falls back to startingPrice
  // when there's no bid yet), effectively giving the item away for free.
  @IsNumber({ maxDecimalPlaces: 2 })
  @Min(0.01)
  startingPrice!: number;

  // > 0 — an increment of 0 would let a "higher" bid tie the current
  // highest, defeating the point of a minimum increment.
  @IsNumber({ maxDecimalPlaces: 2 })
  @Min(0.01)
  minBidIncrement!: number;

  @IsDateString()
  startsAt!: string;

  @IsDateString()
  endsAt!: string;
}
