import { IsEnum, IsUUID } from 'class-validator';
import { RefundStatus } from '@prisma/client';

export class ResolveRefundDto {
  @IsEnum(RefundStatus)
  status!: RefundStatus;

  @IsUUID()
  resolvedById!: string;
}
