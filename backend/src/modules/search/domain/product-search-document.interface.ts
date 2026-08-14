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
  // Only meaningful for type === 'AUCTION': whether the product
  // currently has an ACTIVE or SCHEDULED auction — i.e. whether there's
  // actually something to click through to and bid on right now. A
  // product can accumulate multiple auctions over its lifetime (each
  // re-listed after the last one ends), so this is NOT "has ever had an
  // auction" — an AUCTION product between listings is just as
  // un-actionable as one that's never been auctioned. Always false for
  // FIXED_PRICE. Re-synced whenever an auction is created or ends (see
  // BiddingService.createAuction/endAuction) — the two, and only two,
  // transitions that flip it.
  hasActiveAuction: boolean;
  createdAt: number;
}
