import { Injectable } from '@nestjs/common';
import {
  RefundStatus,
  type LedgerEntry,
  type Prisma,
  type Refund,
} from '@prisma/client';
import { PrismaService } from '../../../infrastructure/prisma/prisma.service';
import { PaymentsLedgerRepository } from '../domain/payments-ledger.repository';

@Injectable()
export class PrismaPaymentsLedgerRepository implements PaymentsLedgerRepository {
  constructor(private readonly prisma: PrismaService) {}

  listLedgerForSeller(sellerId: string): Promise<LedgerEntry[]> {
    return this.prisma.ledgerEntry.findMany({
      where: { sellerId },
      orderBy: { createdAt: 'desc' },
    });
  }

  findRefundById(id: string): Promise<Refund | null> {
    return this.prisma.refund.findUnique({ where: { id } });
  }

  createSystemRefund(
    tx: Prisma.TransactionClient,
    data: { sellerOrderId: string; amount: number; reason: string },
  ): Promise<Refund> {
    // requestedById stays null — see schema.prisma: the saga opened
    // this, not a person.
    return tx.refund.create({ data });
  }

  findRefundForSellerOrder(
    tx: Prisma.TransactionClient,
    sellerOrderId: string,
  ): Promise<Refund | null> {
    return tx.refund.findFirst({
      where: { sellerOrderId, requestedById: null },
      orderBy: { requestedAt: 'desc' },
    });
  }

  async transitionRefundStatusIfCurrent(
    tx: Prisma.TransactionClient,
    id: string,
    expectedCurrent: RefundStatus,
    next: RefundStatus,
    extra?: Partial<{
      gatewayRef: string;
      failureReason: string;
      attempts: number;
      resolvedAt: Date;
    }>,
  ): Promise<Refund | null> {
    const result = await tx.refund.updateMany({
      where: { id, status: expectedCurrent },
      data: { status: next, ...extra },
    });
    if (result.count === 0) {
      return null;
    }
    return tx.refund.findUniqueOrThrow({ where: { id } });
  }
}
