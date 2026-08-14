import { IsNumber, IsOptional, IsString, IsUUID, Min } from 'class-validator';

// No requestedById field — the requester is always the authenticated
// caller (see PaymentsLedgerController.requestRefund / @CurrentUser()),
// never a client-supplied value. Accepting one let any account open a
// refund attributed to somebody else.
export class RequestRefundDto {
  @IsUUID()
  sellerOrderId!: string;

  @IsNumber({ maxDecimalPlaces: 2 })
  @Min(0)
  amount!: number;

  @IsOptional()
  @IsString()
  reason?: string;
}
