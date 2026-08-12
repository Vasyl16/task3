import type { LedgerEntry, Refund } from '@prisma/client';

export abstract class PaymentsLedgerRepository {
  abstract listLedgerForSeller(sellerId: string): Promise<LedgerEntry[]>;
  abstract findRefundById(id: string): Promise<Refund | null>;
  abstract createRefundRequest(data: {
    sellerOrderId: string;
    requestedById: string;
    amount: number;
    reason?: string;
  }): Promise<Refund>;
}
