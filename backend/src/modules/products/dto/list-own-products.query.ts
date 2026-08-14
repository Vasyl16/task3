import { ProductStatus } from '@prisma/client';
import { IsEnum, IsOptional } from 'class-validator';
import { PaginationQuery } from '../../../core/pagination';

export class ListOwnProductsQuery extends PaginationQuery {
  // Omit to see every state, including ARCHIVED — which is the point of
  // this endpoint. There is deliberately no sellerId: the seller is
  // always the authenticated caller.
  @IsOptional()
  @IsEnum(ProductStatus)
  status?: ProductStatus;
}
