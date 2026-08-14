import { IsEnum } from 'class-validator';
import { RefundStatus } from '@prisma/client';

// No resolvedById field — the resolver is always the authenticated ADMIN
// caller (see PaymentsLedgerController.resolveRefund / @CurrentUser()),
// never a client-supplied value. Same rule as ReviewSellerDto.
export class ResolveRefundDto {
  @IsEnum(RefundStatus)
  status!: RefundStatus;
}
