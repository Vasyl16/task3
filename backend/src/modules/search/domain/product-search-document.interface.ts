// The Meilisearch read-model document for a Product — deliberately
// denormalized (categoryName, sellerName, sellerRating) so search
// queries never need a join. Rebuilt from PostgreSQL (the source of
// truth) on every ProductCreated/ProductUpdated event; only ACTIVE
// products are ever indexed — ProductArchived removes the document
// rather than updating it. See SearchSyncConsumer.
export interface ProductSearchDocument {
  id: string;
  name: string;
  description: string | null;
  basePrice: number;
  categoryId: string;
  categoryName: string;
  sellerId: string;
  sellerName: string;
  // Average of Review.rating for this seller, computed at sync time —
  // there is no stored per-product or per-seller rating aggregate in
  // Postgres (see SKILL.md scope notes), so this is null until the
  // seller has at least one review.
  sellerRating: number | null;
  type: string;
  inStock: boolean;
  quantityAvailable: number;
  createdAt: number;
}
