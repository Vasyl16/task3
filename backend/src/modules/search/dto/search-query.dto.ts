import { ProductType } from '@prisma/client';
import { Transform, Type } from 'class-transformer';
import {
  IsBoolean,
  IsEnum,
  IsInt,
  IsNumber,
  IsOptional,
  IsString,
  IsUUID,
  Max,
  Min,
} from 'class-validator';

// The set of sortable attributes this search design supports — kept
// deliberately small and named by intent (not by raw Meilisearch
// attribute name) so SearchService.buildSort is the only place that
// needs to know the underlying document field. See
// modules/search/domain/product-search-document.interface.ts for the
// document shape and MeilisearchService for the configured
// sortableAttributes.
export enum SearchSortBy {
  RELEVANCE = 'relevance',
  PRICE = 'price',
  NEWEST = 'newest',
  RATING = 'rating',
}

export enum SearchSortOrder {
  ASC = 'asc',
  DESC = 'desc',
}

export class SearchQueryDto {
  @IsOptional()
  @IsString()
  q?: string;

  // Validated as UUIDs (not just IsString) specifically because these
  // values get interpolated into a Meilisearch filter expression string
  // — see SearchService.buildFilter. A UUID shape can't break out of the
  // `field = "value"` clause.
  @IsOptional()
  @IsUUID()
  categoryId?: string;

  @IsOptional()
  @IsUUID()
  sellerId?: string;

  @IsOptional()
  @IsEnum(ProductType)
  type?: ProductType;

  @IsOptional()
  @Type(() => Number)
  @IsNumber()
  @Min(0)
  minPrice?: number;

  @IsOptional()
  @Type(() => Number)
  @IsNumber()
  @Min(0)
  maxPrice?: number;

  @IsOptional()
  @Type(() => Number)
  @IsNumber()
  @Min(0)
  @Max(5)
  minRating?: number;

  // @Type(() => Boolean) would coerce the string "false" to `true`
  // (Boolean("false") === true) — an explicit Transform avoids that trap
  // for a query-string boolean.
  @IsOptional()
  @Transform(
    ({ value }: { value: unknown }) => value === 'true' || value === true,
  )
  @IsBoolean()
  inStockOnly?: boolean;

  @IsOptional()
  @IsEnum(SearchSortBy)
  sortBy?: SearchSortBy;

  // Defaults per sortBy (ascending for price, descending for
  // newest/rating) if omitted — see SearchService.buildSort. Has no
  // effect when sortBy is RELEVANCE/unset.
  @IsOptional()
  @IsEnum(SearchSortOrder)
  sortOrder?: SearchSortOrder;

  @IsOptional()
  @Type(() => Number)
  @IsInt()
  @Min(1)
  page?: number = 1;

  @IsOptional()
  @Type(() => Number)
  @IsInt()
  @Min(1)
  @Max(100)
  limit?: number = 20;
}
