import { IsIn, IsOptional, IsUUID } from 'class-validator';
import { PRODUCT_SORTS, type ProductSort } from '../products.service';

export class ListCatalogQuery {
  @IsOptional()
  @IsUUID()
  categoryId?: string;

  @IsOptional()
  @IsUUID()
  sellerId?: string;

  // Allow-listed rather than passed through to Prisma: an unvalidated
  // orderBy would let a caller sort the public catalogue by columns the
  // projection deliberately withholds, which leaks their values through
  // the ordering even though they are never printed.
  @IsOptional()
  @IsIn(PRODUCT_SORTS)
  sort?: ProductSort;
}
