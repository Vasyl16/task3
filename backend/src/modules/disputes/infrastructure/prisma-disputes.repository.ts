import { Injectable } from '@nestjs/common';
import {
  DisputeStatus,
  Prisma,
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

  // Search covers the dispute id and its reason — what someone has in
  // front of them when chasing a case. sellerId filters through the
  // shipment, which is how a seller sees complaints about their own
  // orders without ever being handed another seller's.
  async findMany(
    filter: DisputeListFilter,
  ): Promise<{ items: Dispute[]; total: number }> {
    const search = filter.search?.trim();
    const where: Prisma.DisputeWhereInput = {
      status: filter.status,
      raisedById: filter.raisedById,
      sellerOrderId: filter.sellerOrderId,
      ...(filter.sellerId
        ? { sellerOrder: { sellerId: filter.sellerId } }
        : {}),
      ...(search
        ? {
            OR: [
              { id: { contains: search, mode: 'insensitive' } },
              { reason: { contains: search, mode: 'insensitive' } },
            ],
          }
        : {}),
    };

    const [items, total] = await Promise.all([
      this.prisma.dispute.findMany({
        where,
        orderBy: { createdAt: 'desc' },
        skip: filter.skip,
        take: filter.take,
      }),
      this.prisma.dispute.count({ where }),
    ]);
    return { items, total };
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
            sellerId: true,
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
