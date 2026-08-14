import {
  ForbiddenException,
  Injectable,
  NotFoundException,
  NotImplementedException,
} from '@nestjs/common';
import {
  RefundStatus,
  UserRole,
  type LedgerEntry,
  type Prisma,
  type Refund,
} from '@prisma/client';
import { randomUUID } from 'node:crypto';
import type { AuthenticatedUser } from '../../core/auth/authenticated-user.interface';
import { CorrelationIdService } from '../../core/correlation-id/correlation-id.service';
import { PrismaService } from '../../infrastructure/prisma/prisma.service';
import { OutboxService } from '../../infrastructure/outbox/outbox.service';
import { OrdersService } from '../orders/orders.service';
import { SellersService } from '../sellers/sellers.service';
import { PaymentsLedgerRepository } from './domain/payments-ledger.repository';
import { REFUND_PROCESSED_EVENT } from './domain/events/refund-processed.event';
import { REFUND_FAILED_EVENT } from './domain/events/refund-failed.event';
import { RequestRefundDto } from './dto/request-refund.dto';
import { ResolveRefundDto } from './dto/resolve-refund.dto';

@Injectable()
export class PaymentsLedgerService {
  constructor(
    private readonly paymentsLedgerRepository: PaymentsLedgerRepository,
    private readonly sellersService: SellersService,
    private readonly ordersService: OrdersService,
    private readonly outboxService: OutboxService,
    private readonly correlationIdService: CorrelationIdService,
    private readonly prisma: PrismaService,
  ) {}

  // A seller may read their OWN ledger; ADMIN may read anyone's. The
  // :sellerId in the URL is never trusted on its own — it's compared
  // against the profile resolved from the caller's token, the same
  // primitive products/orders use (see
  // SellersService.getOwnApprovedSellerProfileOrThrow).
  async listLedgerForSeller(
    sellerId: string,
    caller: AuthenticatedUser,
  ): Promise<LedgerEntry[]> {
    await this.sellersService.findById(sellerId); // 404s if missing
    if (caller.role !== UserRole.ADMIN) {
      const ownProfile =
        await this.sellersService.getOwnApprovedSellerProfileOrThrow(caller.id);
      if (ownProfile.id !== sellerId) {
        throw new ForbiddenException('You do not own this ledger');
      }
    }
    return this.paymentsLedgerRepository.listLedgerForSeller(sellerId);
  }

  // Only the buyer who actually placed the order may ask for their money
  // back (ADMIN may act on their behalf) — findSellerOrderAsBuyer 404s
  // for anyone else. requestedById comes from the token, never the body.
  async requestRefund(
    caller: AuthenticatedUser,
    dto: RequestRefundDto,
  ): Promise<Refund> {
    await this.ordersService.findSellerOrderAsBuyer(dto.sellerOrderId, caller);
    return this.paymentsLedgerRepository.createRefundRequest({
      sellerOrderId: dto.sellerOrderId,
      requestedById: caller.id,
      amount: dto.amount,
      reason: dto.reason,
    });
  }

  // Internal lookup — no authorization. Every client-facing path goes
  // through findRefundByIdForCaller instead.
  async findRefundById(id: string): Promise<Refund> {
    const refund = await this.paymentsLedgerRepository.findRefundById(id);
    if (!refund) {
      throw new NotFoundException(`Refund ${id} not found`);
    }
    return refund;
  }

  // A refund is visible to the two parties it concerns — the buyer whose
  // money it is and the seller whose sale it reverses — plus ADMIN.
  // Anyone else gets the same 404 a missing id gets, so refund ids can't
  // be probed for existence.
  async findRefundByIdForCaller(
    id: string,
    caller: AuthenticatedUser,
  ): Promise<Refund> {
    const refund = await this.findRefundById(id); // 404s if missing
    if (caller.role === UserRole.ADMIN) {
      return refund;
    }
    const sellerOrder = await this.ordersService.findSellerOrderById(
      refund.sellerOrderId,
    );
    const ownProfile = await this.sellersService.findByUserId(caller.id);
    if (ownProfile?.id === sellerOrder.sellerId) {
      return refund;
    }
    try {
      await this.ordersService.findSellerOrderAsBuyer(
        refund.sellerOrderId,
        caller,
      );
    } catch {
      // Rethrown as "Refund not found" rather than passing the inner
      // error through: that one names the SellerOrder id, which would
      // tell a stranger which order a refund id belongs to.
      throw new NotFoundException(`Refund ${id} not found`);
    }
    return refund;
  }

  // Approving/processing a refund must reverse the sale in the ledger
  // (LedgerEntryType.REFUND), possibly trigger a real payment-gateway
  // refund, and update SellerOrder.status — atomically. Deliberately not
  // implemented here. ADMIN-only (see the controller); resolvedById will
  // come from `caller`, never a body field.
  async resolveRefund(
    id: string,
    _caller: AuthenticatedUser,
    _dto: ResolveRefundDto,
  ): Promise<Refund> {
    await this.findRefundById(id); // 404s if missing
    throw new NotImplementedException('PaymentsLedgerService.resolveRefund');
  }

  // ===================== Refund saga =====================
  // Driven by RefundConsumer off a SellerOrderStatusChanged(CANCELLED)
  // event. Split into three separately-committed steps on purpose — the
  // gateway call in between them CANNOT be inside a transaction, so each
  // step is written to be safe on its own if the process dies mid-saga.

  // Step 1. Opens the refund, or hands back the one an earlier delivery
  // already opened. Runs on the caller's transaction (the same one that
  // writes the consumer's ProcessedEvent marker).
  async openCancellationRefund(
    tx: Prisma.TransactionClient,
    input: { sellerOrderId: string; amount: number },
  ): Promise<Refund> {
    const existing =
      await this.paymentsLedgerRepository.findRefundForSellerOrder(
        tx,
        input.sellerOrderId,
      );
    if (existing) {
      return existing;
    }
    return this.paymentsLedgerRepository.createSystemRefund(tx, {
      sellerOrderId: input.sellerOrderId,
      amount: input.amount,
      reason: 'Order cancelled',
    });
  }

  // Step 2's recovery read: after a crash between the gateway call and
  // the settle, redelivery needs the refund a previous delivery opened.
  // Its own (non-transactional) read because the caller is between
  // transactions at that point, by design.
  findRefundForSellerOrder(sellerOrderId: string): Promise<Refund | null> {
    return this.paymentsLedgerRepository.findRefundForSellerOrder(
      this.prisma,
      sellerOrderId,
    );
  }

  // Step 3a. The gateway accepted: REQUESTED -> PROCESSED, and announce
  // it. Guarded, so a duplicate delivery that finds the refund already
  // settled records nothing and returns null rather than double-paying
  // the announcement.
  async settleRefund(
    refundId: string,
    input: { gatewayRef: string; attempts: number; buyerId: string },
  ): Promise<Refund | null> {
    const correlationId = this.correlationIdService.getId() ?? randomUUID();
    return this.prisma.$transaction(async (tx) => {
      const settled =
        await this.paymentsLedgerRepository.transitionRefundStatusIfCurrent(
          tx,
          refundId,
          RefundStatus.REQUESTED,
          RefundStatus.PROCESSED,
          {
            gatewayRef: input.gatewayRef,
            attempts: input.attempts,
            resolvedAt: new Date(),
          },
        );
      if (!settled) {
        return null;
      }
      await this.outboxService.record(tx, {
        aggregateType: 'Refund',
        aggregateId: settled.id,
        eventType: REFUND_PROCESSED_EVENT,
        payload: {
          refundId: settled.id,
          sellerOrderId: settled.sellerOrderId,
          buyerId: input.buyerId,
          amount: settled.amount.toString(),
          gatewayRef: input.gatewayRef,
        },
        correlationId,
      });
      return settled;
    });
  }

  // Step 3b. Every retry is spent: REQUESTED -> FAILED, and escalate.
  // Nothing is rolled back here — see refund-failed.event.ts for why a
  // failed refund is a human's problem to finish, not a compensation
  // the system can perform for itself.
  async failRefund(
    refundId: string,
    input: { failureReason: string; attempts: number; buyerId: string },
  ): Promise<Refund | null> {
    const correlationId = this.correlationIdService.getId() ?? randomUUID();
    return this.prisma.$transaction(async (tx) => {
      const failed =
        await this.paymentsLedgerRepository.transitionRefundStatusIfCurrent(
          tx,
          refundId,
          RefundStatus.REQUESTED,
          RefundStatus.FAILED,
          {
            failureReason: input.failureReason,
            attempts: input.attempts,
            resolvedAt: new Date(),
          },
        );
      if (!failed) {
        return null;
      }
      await this.outboxService.record(tx, {
        aggregateType: 'Refund',
        aggregateId: failed.id,
        eventType: REFUND_FAILED_EVENT,
        payload: {
          refundId: failed.id,
          sellerOrderId: failed.sellerOrderId,
          buyerId: input.buyerId,
          amount: failed.amount.toString(),
          attempts: input.attempts,
          failureReason: input.failureReason,
        },
        correlationId,
      });
      return failed;
    });
  }
}
