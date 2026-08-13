import { IsString, IsUUID, MaxLength, MinLength } from 'class-validator';

export class CreateDisputeDto {
  @IsUUID()
  sellerOrderId!: string;

  // The raiser is NEVER taken from the body — it's the authenticated
  // caller (see DisputesController.raise).
  @IsString()
  @MinLength(10)
  @MaxLength(2000)
  reason!: string;
}
