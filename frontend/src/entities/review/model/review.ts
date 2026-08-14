// Mirrors backend/src/modules/reviews. Every row here is a verified
// purchase by construction — the backend will not create one without an
// OrderItem belonging to the author on a COMPLETED order.
export interface Review {
  id: string;
  orderItemId: string;
  productId: string;
  authorId: string;
  sellerId: string;
  rating: number;
  comment: string | null;
  createdAt: string;
  updatedAt: string;
}

// What a product page shows above the fold. Aggregated live by the
// backend from the review rows, so it cannot disagree with the list
// rendered underneath it.
export interface ProductRating {
  productId: string;
  average: number;
  count: number;
}

export interface CreateReviewInput {
  // The purchased line item, not a productId: the backend derives the
  // product from the purchase so a client cannot rate something it did
  // not buy.
  orderItemId: string;
  rating: number;
  comment?: string;
}

// A delivered purchase the signed-in customer has not reviewed yet.
// Comes from GET /reviews/pending — the client cannot derive it, since
// the orders endpoints return no line items.
export interface ReviewablePurchase {
  orderItemId: string;
  productId: string;
  productName: string;
  sellerOrderId: string;
  purchasedAt: string;
}
