import { Test } from '@nestjs/testing';
import {
  ConflictException,
  ForbiddenException,
  NotFoundException,
} from '@nestjs/common';
import { SellerOrderStatus, UserRole, type Review } from '@prisma/client';
import type { AuthenticatedUser } from '../../core/auth/authenticated-user.interface';
import {
  PurchaseContext,
  ReviewsRepository,
} from './domain/reviews.repository';
import { ReviewsService } from './reviews.service';

const BUYER: AuthenticatedUser = {
  id: 'buyer-1',
  email: 'buyer@example.com',
  role: UserRole.CUSTOMER,
};

const STRANGER: AuthenticatedUser = {
  id: 'stranger-1',
  email: 'stranger@example.com',
  role: UserRole.CUSTOMER,
};

function buildPurchase(overrides: Partial<PurchaseContext> = {}) {
  return {
    orderItemId: 'item-1',
    productId: 'product-1',
    sellerId: 'seller-1',
    buyerId: BUYER.id,
    sellerOrderStatus: SellerOrderStatus.COMPLETED,
    ...overrides,
  } satisfies PurchaseContext;
}

describe('ReviewsService', () => {
  let reviewsService: ReviewsService;
  let reviewsRepository: jest.Mocked<ReviewsRepository>;

  beforeEach(async () => {
    reviewsRepository = {
      findPurchaseContext: jest.fn().mockResolvedValue(buildPurchase()),
      findByOrderItemId: jest.fn().mockResolvedValue(null),
      create: jest.fn().mockResolvedValue({ id: 'review-1' }),
      findManyForProduct: jest.fn().mockResolvedValue([]),
      findManyByAuthor: jest.fn().mockResolvedValue([]),
      findReviewablePurchases: jest.fn().mockResolvedValue([]),
      summarizeForProducts: jest.fn().mockResolvedValue([]),
    };

    const moduleRef = await Test.createTestingModule({
      providers: [
        ReviewsService,
        { provide: ReviewsRepository, useValue: reviewsRepository },
      ],
    }).compile();

    reviewsService = moduleRef.get(ReviewsService);
  });

  describe('verified purchase', () => {
    it('records a review for a completed purchase the caller made', async () => {
      await reviewsService.create(BUYER, { orderItemId: 'item-1', rating: 5 });

      expect(reviewsRepository.create).toHaveBeenCalledWith(
        expect.objectContaining({
          orderItemId: 'item-1',
          // Taken from the purchase, never from the request: the client
          // does not get to say which product it is rating.
          productId: 'product-1',
          sellerId: 'seller-1',
          authorId: BUYER.id,
          rating: 5,
        }),
      );
    });

    it('rejects a review for a purchase belonging to someone else', async () => {
      await expect(
        reviewsService.create(STRANGER, { orderItemId: 'item-1', rating: 5 }),
      ).rejects.toBeInstanceOf(NotFoundException);

      expect(reviewsRepository.create).not.toHaveBeenCalled();
    });

    it('reports a foreign purchase as 404, not 403, so it cannot be used to probe for real order items', async () => {
      await expect(
        reviewsService.create(STRANGER, { orderItemId: 'item-1', rating: 5 }),
      ).rejects.not.toBeInstanceOf(ForbiddenException);
    });

    it('rejects a review for a line item that does not exist', async () => {
      reviewsRepository.findPurchaseContext.mockResolvedValue(null);

      await expect(
        reviewsService.create(BUYER, { orderItemId: 'nope', rating: 4 }),
      ).rejects.toBeInstanceOf(NotFoundException);
    });

    // The core rule: paying is not the same as receiving. Allowing a
    // review before completion would let someone buy, rate, and cancel.
    it.each([
      SellerOrderStatus.NEW,
      SellerOrderStatus.PROCESSING,
      SellerOrderStatus.SHIPPED,
      SellerOrderStatus.CANCELLED,
      SellerOrderStatus.REFUNDED,
    ])('refuses to review an order still in %s', async (status) => {
      reviewsRepository.findPurchaseContext.mockResolvedValue(
        buildPurchase({ sellerOrderStatus: status }),
      );

      await expect(
        reviewsService.create(BUYER, { orderItemId: 'item-1', rating: 5 }),
      ).rejects.toBeInstanceOf(ForbiddenException);

      expect(reviewsRepository.create).not.toHaveBeenCalled();
    });

    it('rejects a second review of the same purchase', async () => {
      reviewsRepository.findByOrderItemId.mockResolvedValue({
        id: 'existing',
      } as Review);

      await expect(
        reviewsService.create(BUYER, { orderItemId: 'item-1', rating: 1 }),
      ).rejects.toBeInstanceOf(ConflictException);

      expect(reviewsRepository.create).not.toHaveBeenCalled();
    });
  });

  describe('ratings', () => {
    it('reports a product nobody has reviewed as 0/0 rather than missing', async () => {
      await expect(reviewsService.getRatingFor('product-1')).resolves.toEqual({
        productId: 'product-1',
        average: 0,
        count: 0,
      });
    });

    it('returns a lookup keyed by product so a catalogue can be enriched without rescanning', async () => {
      reviewsRepository.summarizeForProducts.mockResolvedValue([
        { productId: 'a', average: 4.5, count: 2 },
        { productId: 'b', average: 3, count: 1 },
      ]);

      const ratings = await reviewsService.getRatingsFor(['a', 'b']);

      expect(ratings.get('a')).toEqual({
        productId: 'a',
        average: 4.5,
        count: 2,
      });
      expect(ratings.get('b')?.average).toBe(3);
    });
  });
});
