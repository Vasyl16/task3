import { Injectable } from '@nestjs/common';
import { SellerOrderStatus, type Review } from '@prisma/client';
import { PrismaService } from '../../../infrastructure/prisma/prisma.service';
import {
  ProductRatingSummary,
  PurchaseContext,
  ReviewablePurchase,
  ReviewsRepository,
} from '../domain/reviews.repository';

@Injectable()
export class PrismaReviewsRepository extends ReviewsRepository {
  constructor(private readonly prisma: PrismaService) {
    super();
  }

  async findPurchaseContext(
    orderItemId: string,
  ): Promise<PurchaseContext | null> {
    const item = await this.prisma.orderItem.findUnique({
      where: { id: orderItemId },
      select: {
        id: true,
        productId: true,
        sellerOrder: {
          select: {
            sellerId: true,
            status: true,
            order: { select: { buyerId: true } },
          },
        },
      },
    });
    if (!item) return null;

    return {
      orderItemId: item.id,
      productId: item.productId,
      sellerId: item.sellerOrder.sellerId,
      buyerId: item.sellerOrder.order.buyerId,
      sellerOrderStatus: item.sellerOrder.status,
    };
  }

  findByOrderItemId(orderItemId: string): Promise<Review | null> {
    return this.prisma.review.findUnique({ where: { orderItemId } });
  }

  create(data: {
    orderItemId: string;
    productId: string;
    sellerId: string;
    authorId: string;
    rating: number;
    comment?: string;
  }): Promise<Review> {
    return this.prisma.review.create({ data });
  }

  findManyForProduct(productId: string): Promise<Review[]> {
    return this.prisma.review.findMany({
      where: { productId },
      orderBy: { createdAt: 'desc' },
    });
  }

  findManyByAuthor(authorId: string): Promise<Review[]> {
    return this.prisma.review.findMany({
      where: { authorId },
      orderBy: { createdAt: 'desc' },
    });
  }

  async findReviewablePurchases(
    buyerId: string,
  ): Promise<ReviewablePurchase[]> {
    const items = await this.prisma.orderItem.findMany({
      where: {
        // `review: null` is the whole point — an already-reviewed line
        // must drop off this list, and that fact lives on Review, not on
        // anything the order itself exposes.
        review: { is: null },
        sellerOrder: {
          status: SellerOrderStatus.COMPLETED,
          order: { buyerId },
        },
      },
      select: {
        id: true,
        productId: true,
        sellerOrderId: true,
        createdAt: true,
        product: { select: { name: true } },
      },
      orderBy: { createdAt: 'desc' },
    });

    return items.map((item) => ({
      orderItemId: item.id,
      productId: item.productId,
      productName: item.product.name,
      sellerOrderId: item.sellerOrderId,
      purchasedAt: item.createdAt,
    }));
  }

  async summarizeForProducts(
    productIds: string[],
  ): Promise<ProductRatingSummary[]> {
    if (productIds.length === 0) return [];

    const grouped = await this.prisma.review.groupBy({
      by: ['productId'],
      where: { productId: { in: productIds } },
      _avg: { rating: true },
      _count: { _all: true },
    });

    return grouped.map((row) => ({
      productId: row.productId,
      // Rounded to one decimal for display. The underlying rows stay
      // exact — this is a presentation choice, not stored state.
      average: Math.round((row._avg.rating ?? 0) * 10) / 10,
      count: row._count._all,
    }));
  }
}
