import type { LedgerEntry, Prisma, Refund, RefundStatus } from '@prisma/client';

export abstract class PaymentsLedgerRepository {
  abstract listLedgerForSeller(sellerId: string): Promise<LedgerEntry[]>;
  abstract findRefundById(id: string): Promise<Refund | null>;

  // ===================== Refund saga =====================

  // The saga's first step. Takes the caller's transaction client: the
  // Refund row is created in the same transaction as the ProcessedEvent
  // marker that records the cancellation was consumed, so a crash can't
  // leave the event marked handled with no refund to show for it.
  abstract createSystemRefund(
    tx: Prisma.TransactionClient,
    data: { sellerOrderId: string; amount: number; reason: string },
  ): Promise<Refund>;

  // Lets a redelivered cancellation find the refund a previous delivery
  // already opened, instead of opening a second one for the same money.
  abstract findRefundForSellerOrder(
    tx: Prisma.TransactionClient,
    sellerOrderId: string,
  ): Promise<Refund | null>;

  // Guarded, idempotent-by-construction transition — succeeds only if
  // the row is still in `expectedCurrent`, so two concurrent deliveries
  // can't both settle the same refund. Returns null when it has already
  // moved on. Same shape as BiddingRepository.transitionStatusIfCurrent.
  abstract transitionRefundStatusIfCurrent(
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
  ): Promise<Refund | null>;
}
