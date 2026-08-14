import { DisputeStatus } from '@prisma/client';
import { IsEnum, IsOptional, IsUUID } from 'class-validator';
import { PaginationQuery } from '../../../core/pagination';

export class ListDisputesQuery extends PaginationQuery {
  @IsOptional()
  @IsEnum(DisputeStatus)
  status?: DisputeStatus;

  @IsOptional()
  @IsUUID()
  sellerOrderId?: string;
}
