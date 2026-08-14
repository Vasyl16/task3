import {
  IsOptional,
  IsString,
  IsUUID,
  MaxLength,
  MinLength,
} from 'class-validator';

export class CreateDisputeDto {
  @IsUUID()
  sellerOrderId!: string;

  // Optional: omit it to dispute the whole shipment (nothing arrived),
  // or name a line to dispute just that item. Validated against the
  // order — a line from someone else's purchase is rejected.
  @IsOptional()
  @IsUUID()
  orderItemId?: string;

  // The raiser is NEVER taken from the body — it's the authenticated
  // caller (see DisputesController.raise).
  @IsString()
  @MinLength(10)
  @MaxLength(2000)
  reason!: string;
}
