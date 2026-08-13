import { IsDateString, IsNumber, IsUUID, Min } from 'class-validator';

// No sellerId field — the owning seller is always derived from the
// authenticated caller's own (approved) SellerProfile, never a
// client-supplied value. Same pattern as CreateProductDto. See
// BiddingController.createAuction.
export class CreateAuctionDto {
  @IsUUID()
  productId!: string;

  @IsNumber({ maxDecimalPlaces: 2 })
  @Min(0)
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
