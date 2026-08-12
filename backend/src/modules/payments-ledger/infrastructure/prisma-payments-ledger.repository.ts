import { Injectable } from '@nestjs/common';
import type { LedgerEntry, Refund } from '@prisma/client';
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

  createRefundRequest(data: {
    sellerOrderId: string;
    requestedById: string;
    amount: number;
    reason?: string;
  }): Promise<Refund> {
    return this.prisma.refund.create({ data });
  }
}
