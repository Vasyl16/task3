import { ProductStatus } from '@prisma/client';
import { IsEnum, IsOptional, IsUUID } from 'class-validator';
import { PaginationQuery } from '../../../core/pagination';

export class ListProductsForModerationQuery extends PaginationQuery {
  @IsOptional()
  @IsEnum(ProductStatus)
  status?: ProductStatus;

  // Narrows the queue to one seller — e.g. after a dispute names them.
  @IsOptional()
  @IsUUID()
  sellerId?: string;
}
