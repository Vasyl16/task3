import type { ProductType } from './product';

export type SearchSortBy = 'relevance' | 'price' | 'newest' | 'rating';
export type SearchSortOrder = 'asc' | 'desc';

export interface SearchQuery {
  q?: string;
  categoryId?: string;
  sellerId?: string;
  type?: ProductType;
  minPrice?: number;
  maxPrice?: number;
  minRating?: number;
  inStockOnly?: boolean;
  sortBy?: SearchSortBy;
  sortOrder?: SearchSortOrder;
  page?: number;
  limit?: number;
}

// The search read model's own shape — a Meilisearch document, not a
// Prisma row, so basePrice/productRating are genuine JS numbers here
// (unlike Product.basePrice, which is a Decimal-as-string).
export interface SearchResultItem {
  productId: string;
  name: string;
  description: string | null;
  basePrice: number;
  categoryId: string;
  categoryName: string;
  sellerId: string;
  sellerName: string;
  productRating: number | null;
  type: ProductType;
  inStock: boolean;
  // Only meaningful when type === 'AUCTION': is there currently an
  // ACTIVE/SCHEDULED auction for this product? A product can be
  // between listings (its last auction ended, no new one created yet)
  // — always false for FIXED_PRICE. See ProductSearchDocument on the
  // backend.
  hasActiveAuction: boolean;
}

export interface SearchResult {
  items: SearchResultItem[];
  total: number;
  page: number;
  limit: number;
  facets?: Record<string, Record<string, number>>;
}
