import {
  ConflictException,
  ForbiddenException,
  Injectable,
  Logger,
  NotFoundException,
} from '@nestjs/common';
import { SellerOrderStatus, type Review } from '@prisma/client';
import type { AuthenticatedUser } from '../../core/auth/authenticated-user.interface';
import {
  ProductRatingSummary,
  ReviewablePurchase,
  ReviewsRepository,
} from './domain/reviews.repository';
import { CreateReviewDto } from './dto/create-review.dto';

@Injectable()
export class ReviewsService {
  private readonly logger = new Logger(ReviewsService.name);

  constructor(private readonly reviewsRepository: ReviewsRepository) {}

  // The whole point of the feature: a rating only counts if the person
  // giving it actually bought the thing. Four conditions, in this order:
  //
  //   1. the line item exists
  //   2. the caller is the buyer on the order it belongs to
  //   3. that order reached COMPLETED
  //   4. it has not already been reviewed
  //
  // (2) returns 404 rather than 403, matching the rest of the API: a 403
  // would confirm the id exists and turn this into an existence oracle
  // for other people's orders.
  //
  // (3) is what "confirmed" means here. A buyer who has paid but not yet
  // received the goods has no basis to rate them, and allowing it would
  // let someone buy, review, and cancel.
  async create(
    caller: AuthenticatedUser,
    dto: CreateReviewDto,
  ): Promise<Review> {
    const purchase = await this.reviewsRepository.findPurchaseContext(
      dto.orderItemId,
    );
    if (!purchase || purchase.buyerId !== caller.id) {
      throw new NotFoundException(`Order item ${dto.orderItemId} not found`);
    }

    if (purchase.sellerOrderStatus !== SellerOrderStatus.COMPLETED) {
      throw new ForbiddenException(
        'You can only review an order once it has been completed',
      );
    }

    // The unique constraint on Review.orderItemId is the real guarantee
    // under a concurrent double-submit; this check exists to turn that
    // into a clear 409 instead of a raw constraint violation.
    const existing = await this.reviewsRepository.findByOrderItemId(
      dto.orderItemId,
    );
    if (existing) {
      throw new ConflictException('You have already reviewed this purchase');
    }

    const review = await this.reviewsRepository.create({
      orderItemId: dto.orderItemId,
      productId: purchase.productId,
      sellerId: purchase.sellerId,
      authorId: caller.id,
      rating: dto.rating,
      comment: dto.comment,
    });

    this.logger.log({
      event: 'review.created',
      userId: caller.id,
      entityType: 'Review',
      entityId: review.id,
      productId: review.productId,
      rating: review.rating,
    });
    return review;
  }

  listForProduct(productId: string): Promise<Review[]> {
    return this.reviewsRepository.findManyForProduct(productId);
  }

  listReviewablePurchases(
    caller: AuthenticatedUser,
  ): Promise<ReviewablePurchase[]> {
    return this.reviewsRepository.findReviewablePurchases(caller.id);
  }

  listOwn(caller: AuthenticatedUser): Promise<Review[]> {
    return this.reviewsRepository.findManyByAuthor(caller.id);
  }

  // Returned as a Map so callers can enrich a list of products without a
  // linear scan per row.
  async getRatingsFor(
    productIds: string[],
  ): Promise<Map<string, ProductRatingSummary>> {
    const summaries =
      await this.reviewsRepository.summarizeForProducts(productIds);
    return new Map(summaries.map((s) => [s.productId, s]));
  }

  async getRatingFor(productId: string): Promise<ProductRatingSummary> {
    const ratings = await this.getRatingsFor([productId]);
    // A product nobody has reviewed has a real answer — no reviews —
    // rather than a missing one the frontend has to special-case.
    return ratings.get(productId) ?? { productId, average: 0, count: 0 };
  }
}
