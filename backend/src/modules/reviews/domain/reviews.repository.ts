import type { Prisma, Review, SellerOrderStatus } from '@prisma/client';

// Everything needed to decide whether a review is allowed, read in one
// go. Assembled from OrderItem -> SellerOrder -> Order, which is the
// chain that connects a product to the person who actually paid for it.
export interface PurchaseContext {
  orderItemId: string;
  productId: string;
  sellerId: string;
  buyerId: string;
  sellerOrderStatus: SellerOrderStatus;
}

// A product's rating as currently recorded. Computed from the Review
// rows themselves on every read rather than kept as a column on Product:
// a stored average is a second source of truth for a number that is
// cheap to derive, and the moment a review is edited or removed it can
// disagree with the rows it claims to summarise.
export interface ProductRatingSummary {
  productId: string;
  average: number;
  count: number;
}

// A delivered purchase the buyer has not reviewed yet. This is the list
// that answers "what can I review?", which the client cannot work out on
// its own: the orders endpoints do not return line items, and whether a
// review already exists is not visible from an order at all.
export interface ReviewablePurchase {
  orderItemId: string;
  productId: string;
  productName: string;
  sellerOrderId: string;
  purchasedAt: Date;
}

export abstract class ReviewsRepository {
  abstract findPurchaseContext(
    orderItemId: string,
  ): Promise<PurchaseContext | null>;

  abstract findByOrderItemId(orderItemId: string): Promise<Review | null>;

  // tx: the review write and the search-resync outbox event it triggers
  // must land atomically — see ReviewsService.create.
  abstract create(
    tx: Prisma.TransactionClient,
    data: {
      orderItemId: string;
      productId: string;
      sellerId: string;
      authorId: string;
      rating: number;
      comment?: string;
    },
  ): Promise<Review>;

  abstract findManyForProduct(productId: string): Promise<Review[]>;

  abstract findManyByAuthor(authorId: string): Promise<Review[]>;

  abstract findReviewablePurchases(
    buyerId: string,
  ): Promise<ReviewablePurchase[]>;

  // Batched deliberately: the catalogue needs a rating for every product
  // it is about to return, and asking per product would be one query per
  // row.
  abstract summarizeForProducts(
    productIds: string[],
  ): Promise<ProductRatingSummary[]>;
}
