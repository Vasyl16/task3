import { Injectable } from '@nestjs/common';
import {
  DisputeStatus,
  type Dispute,
  type DisputeComment,
} from '@prisma/client';
import { PrismaService } from '../../../infrastructure/prisma/prisma.service';
import {
  DisputeListFilter,
  DisputesRepository,
  type DisputeWithOrderContext,
} from '../domain/disputes.repository';

@Injectable()
export class PrismaDisputesRepository implements DisputesRepository {
  constructor(private readonly prisma: PrismaService) {}

  findById(id: string): Promise<Dispute | null> {
    return this.prisma.dispute.findUnique({ where: { id } });
  }

  findMany(filter: DisputeListFilter): Promise<Dispute[]> {
    return this.prisma.dispute.findMany({
      where: {
        status: filter.status,
        raisedById: filter.raisedById,
        sellerOrderId: filter.sellerOrderId,
      },
      orderBy: { createdAt: 'desc' },
    });
  }

  findByIdWithOrder(id: string): Promise<DisputeWithOrderContext | null> {
    return this.prisma.dispute.findUnique({
      where: { id },
      include: {
        sellerOrder: {
          select: {
            id: true,
            status: true,
            subtotal: true,
            orderId: true,
            items: {
              select: {
                id: true,
                quantity: true,
                unitPrice: true,
                productId: true,
                product: {
                  select: {
                    id: true,
                    name: true,
                    slug: true,
                    imageUrl: true,
                  },
                },
              },
            },
          },
        },
      },
    });
  }

  findActiveFor(scope: {
    sellerOrderId: string;
    orderItemId?: string | null;
  }): Promise<Dispute | null> {
    return this.prisma.dispute.findFirst({
      where: {
        sellerOrderId: scope.sellerOrderId,
        // `null` is a real value to match here, not "any": an
        // order-wide dispute must not be mistaken for a line-level one.
        orderItemId: scope.orderItemId ?? null,
        status: { in: [DisputeStatus.OPEN, DisputeStatus.UNDER_REVIEW] },
      },
    });
  }

  async findOrderItemInSellerOrder(
    sellerOrderId: string,
    orderItemId: string,
  ): Promise<{ id: string } | null> {
    return this.prisma.orderItem.findFirst({
      where: { id: orderItemId, sellerOrderId },
      select: { id: true },
    });
  }

  create(data: {
    sellerOrderId: string;
    orderItemId?: string | null;
    raisedById: string;
    reason: string;
  }): Promise<Dispute> {
    return this.prisma.dispute.create({ data });
  }

  resolve(
    id: string,
    data: { status: DisputeStatus; resolution?: string; resolvedById: string },
  ): Promise<Dispute> {
    return this.prisma.dispute.update({
      where: { id },
      data: {
        status: data.status,
        resolution: data.resolution,
        resolvedById: data.resolvedById,
        resolvedAt: new Date(),
      },
    });
  }

  findComments(disputeId: string): Promise<DisputeComment[]> {
    return this.prisma.disputeComment.findMany({
      where: { disputeId },
      orderBy: { createdAt: 'asc' },
    });
  }

  addComment(data: {
    disputeId: string;
    authorId: string;
    body: string;
  }): Promise<DisputeComment> {
    return this.prisma.disputeComment.create({ data });
  }
}
