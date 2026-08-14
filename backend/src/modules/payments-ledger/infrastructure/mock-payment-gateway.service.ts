import { Injectable, Logger } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import { randomUUID } from 'node:crypto';
import type { AppConfig } from '../../../config/configuration';

// Thrown for a refund the provider refused. Distinct from a programming
// error so RefundConsumer can tell "the gateway said no" (retry, then
// escalate) apart from "our own code is broken" (fail loudly).
export class PaymentGatewayError extends Error {
  constructor(reason: string) {
    super(reason);
    this.name = 'PaymentGatewayError';
  }
}

export interface RefundResult {
  gatewayRef: string;
}

// Stands in for a real payment provider (Stripe et al). There is no
// payment system in this project, so nothing here moves money — but the
// SHAPE is what matters to the saga around it, and it's deliberately
// faithful in the three ways that shape the design:
//
//   1. It can fail, and failure is normal, not exceptional.
//   2. It is OUTSIDE the database, so it cannot join our transaction —
//      which is the entire reason the refund is a saga step instead of
//      one more write in the cancellation transaction.
//   3. It takes an idempotency key. Every real provider offers one,
//      because a network timeout leaves the caller genuinely unable to
//      tell whether the refund happened. The saga's retry depends on
//      this: replaying a refund with the same key must not move money
//      twice, and here that's enforced by returning the FIRST call's
//      reference for a repeated key.
//
// Swapping this for a real provider means implementing this interface
// and nothing else — no caller knows the difference.
@Injectable()
export class MockPaymentGatewayService {
  private readonly logger = new Logger(MockPaymentGatewayService.name);
  // Stands in for the provider's own idempotency store.
  private readonly processedKeys = new Map<string, string>();

  constructor(private readonly configService: ConfigService<AppConfig, true>) {}

  async refund(input: {
    idempotencyKey: string;
    amount: number;
    reference: string;
  }): Promise<RefundResult> {
    const existing = this.processedKeys.get(input.idempotencyKey);
    if (existing) {
      this.logger.log({
        event: 'payment_gateway.refund_replayed',
        entityType: 'Refund',
        entityId: input.reference,
        gatewayRef: existing,
      });
      return { gatewayRef: existing };
    }

    // Simulated latency — the point being that this is a network hop,
    // which is why it must not happen inside a database transaction.
    await new Promise((resolve) => setTimeout(resolve, 25));

    if (this.shouldFail()) {
      this.logger.warn({
        event: 'payment_gateway.refund_declined',
        entityType: 'Refund',
        entityId: input.reference,
        amount: input.amount,
      });
      throw new PaymentGatewayError('Provider declined the refund');
    }

    const gatewayRef = `mock_re_${randomUUID()}`;
    this.processedKeys.set(input.idempotencyKey, gatewayRef);
    this.logger.log({
      event: 'payment_gateway.refund_succeeded',
      entityType: 'Refund',
      entityId: input.reference,
      amount: input.amount,
      gatewayRef,
    });
    return { gatewayRef };
  }

  // Defaults to 0 — a dev run shouldn't randomly fail refunds. Set
  // PAYMENT_GATEWAY_FAILURE_RATE=1 to exercise the escalation path end
  // to end without touching code.
  private shouldFail(): boolean {
    const rate = this.configService.get('payments.gatewayFailureRate', {
      infer: true,
    });
    return rate > 0 && Math.random() < rate;
  }
}
