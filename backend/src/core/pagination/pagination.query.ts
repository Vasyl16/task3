import { Type } from 'class-transformer';
import {
  IsInt,
  IsOptional,
  IsString,
  Max,
  MaxLength,
  Min,
} from 'class-validator';

// One pagination contract for every list in the API, matching the shape
// SearchQuery already used — a second convention would mean two ways to
// read a page and two ways to get it wrong.
//
// Extend this rather than redeclaring page/limit per query DTO, so the
// bounds (and the reason for them) live in one place.
export class PaginationQuery {
  @IsOptional()
  @Type(() => Number)
  @IsInt()
  @Min(1)
  page?: number = 1;

  // Capped: an unbounded limit is a denial-of-service knob a client
  // should not hold, and every one of these lists joins related rows.
  @IsOptional()
  @Type(() => Number)
  @IsInt()
  @Min(1)
  @Max(100)
  limit?: number = 20;

  // Free-text search. Applied in SQL, not after the page is selected —
  // filtering a page that has already been cut would search only the
  // rows that happened to land on it.
  @IsOptional()
  @IsString()
  @MaxLength(200)
  search?: string;
}

// The response shape every paginated endpoint returns.
export interface Paginated<T> {
  items: T[];
  total: number;
  page: number;
  limit: number;
}

// Normalises the query into the skip/take a repository needs, so no
// caller re-derives it (and no caller forgets the defaults).
export function toPageParams(query: PaginationQuery): {
  skip: number;
  take: number;
  page: number;
  limit: number;
} {
  const page = query.page ?? 1;
  const limit = query.limit ?? 20;
  return { skip: (page - 1) * limit, take: limit, page, limit };
}
