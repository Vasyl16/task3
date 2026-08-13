import { Injectable } from '@nestjs/common';
import { DisputeStatus, type Dispute } from '@prisma/client';
import { PrismaService } from '../../../infrastructure/prisma/prisma.service';
import {
  DisputeListFilter,
  DisputesRepository,
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

  findActiveForSellerOrder(sellerOrderId: string): Promise<Dispute | null> {
    return this.prisma.dispute.findFirst({
      where: {
        sellerOrderId,
        status: { in: [DisputeStatus.OPEN, DisputeStatus.UNDER_REVIEW] },
      },
    });
  }

  create(data: {
    sellerOrderId: string;
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
}
