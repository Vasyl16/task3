import { ProductStatus } from '@prisma/client';
import { IsEnum, IsOptional } from 'class-validator';

export class ListOwnProductsQuery {
  // Omit to see every state, including ARCHIVED — which is the point of
  // this endpoint. There is deliberately no sellerId: the seller is
  // always the authenticated caller.
  @IsOptional()
  @IsEnum(ProductStatus)
  status?: ProductStatus;
}
