export interface SearchResultItem {
  productId: string;
  name: string;
  description: string | null;
  basePrice: number;
  categoryId: string;
  categoryName: string;
  sellerId: string;
  sellerName: string;
  sellerRating: number | null;
  type: string;
  inStock: boolean;
  hasActiveAuction: boolean;
}

export interface SearchResult {
  items: SearchResultItem[];
  total: number;
  page: number;
  limit: number;
  facets?: Record<string, Record<string, number>>;
}
