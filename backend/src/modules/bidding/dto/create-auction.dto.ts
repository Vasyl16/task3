import { IsDateString, IsNumber, IsUUID, Min } from 'class-validator';

export class CreateAuctionDto {
  @IsUUID()
  productId!: string;

  @IsUUID()
  sellerId!: string;

  @IsNumber({ maxDecimalPlaces: 2 })
  @Min(0)
  startingPrice!: number;

  @IsDateString()
  startsAt!: string;

  @IsDateString()
  endsAt!: string;
}
