import { IsNumber, IsOptional, IsString, IsUUID, Min } from 'class-validator';

export class RequestRefundDto {
  @IsUUID()
  sellerOrderId!: string;

  @IsUUID()
  requestedById!: string;

  @IsNumber({ maxDecimalPlaces: 2 })
  @Min(0)
  amount!: number;

  @IsOptional()
  @IsString()
  reason?: string;
}
