import { IsNumber, IsUUID, Min } from 'class-validator';

export class PlaceBidDto {
  @IsUUID()
  bidderId!: string;

  @IsNumber({ maxDecimalPlaces: 2 })
  @Min(0)
  amount!: number;
}
