import { RefundStatus, SellerOrderStatus } from '@prisma/client';
import type { Job } from 'bullmq';
import type { DomainEventJob } from '../../../infrastructure/queue/domain-event-job.interface';
import type { CorrelationIdService } from '../../../core/correlation-id/correlation-id.service';
import type { MetricsService } from '../../../infrastructure/metrics/metrics.service';
import type { EventIdempotencyService } from '../../../infrastructure/idempotency/event-idempotency.service';
import type { OrdersService } from '../../orders/orders.service';
import type { PaymentsLedgerService } from '../payments-ledger.service';
import {
  MockPaymentGatewayService,
  PaymentGatewayError,
} from '../infrastructure/mock-payment-gateway.service';
import { RefundConsumer } from './refund.consumer';
import { SELLER_ORDER_STATUS_CHANGED_EVENT } from '../../orders/domain/events/seller-order-status-changed.event';

// The saga's whole reason for existing is the step that can't be in a
// transaction, so what's asserted here is the behaviour AROUND that
// step: it opens exactly one refund, it lets BullMQ own the retries, it
// escalates instead of losing the money when retries run out, and a
// redelivery never pays twice.
describe('RefundConsumer (refund saga)', () => {
  let consumer: RefundConsumer;
  let paymentsLedgerService: jest.Mocked<
    Pick<
      PaymentsLedgerService,
      | 'openCancellationRefund'
      | 'settleRefund'
      | 'failRefund'
      | 'findRefundForSellerOrder'
    >
  >;
  let ordersService: jest.Mocked<Pick<OrdersService, 'findSellerOrderById'>>;
  let gateway: jest.Mocked<Pick<MockPaymentGatewayService, 'refund'>>;
  let eventIdempotency: jest.Mocked<Pick<EventIdempotencyService, 'run'>>;

  const REFUND = {
    id: 'refund-1',
    sellerOrderId: 'seller-order-1',
    status: RefundStatus.REQUESTED,
    amount: '40.00',
  };

  function buildJob(overrides?: {
    status?: string;
    attemptsMade?: number;
    attempts?: number;
  }): Job<DomainEventJob> {
    return {
      data: {
        eventId: 'event-1',
        eventType: SELLER_ORDER_STATUS_CHANGED_EVENT,
        correlationId: 'corr-1',
        payload: {
          sellerOrderId: 'seller-order-1',
          orderId: 'order-1',
          buyerId: 'buyer-1',
          status: overrides?.status ?? SellerOrderStatus.CANCELLED,
        },
      },
      attemptsMade: overrides?.attemptsMade ?? 0,
      opts: { attempts: overrides?.attempts ?? 5 },
    } as unknown as Job<DomainEventJob>;
  }

  // handleEvent is protected — the consumer's contract is "process this
  // job", so the test drives it the way BullMQ does.
  function process(job: Job<DomainEventJob>): Promise<void> {
    return (
      consumer as unknown as {
        handleEvent: (j: Job<DomainEventJob>) => Promise<void>;
      }
    ).handleEvent(job);
  }

  beforeEach(() => {
    paymentsLedgerService = {
      openCancellationRefund: jest.fn().mockResolvedValue(REFUND),
      settleRefund: jest.fn().mockResolvedValue(REFUND),
      failRefund: jest.fn().mockResolvedValue(REFUND),
      findRefundForSellerOrder: jest.fn(),
    };
    ordersService = {
      findSellerOrderById: jest
        .fn()
        .mockResolvedValue({ id: 'seller-order-1', subtotal: '40.00' }),
    };
    gateway = {
      refund: jest.fn().mockResolvedValue({ gatewayRef: 'mock_re_1' }),
    };
    eventIdempotency = {
      run: jest.fn().mockImplementation(async (_name, _id, work) => {
        await work({});
        return 'processed';
      }),
    };

    consumer = new RefundConsumer(
      paymentsLedgerService as unknown as PaymentsLedgerService,
      ordersService as unknown as OrdersService,
      gateway as unknown as MockPaymentGatewayService,
      eventIdempotency as unknown as EventIdempotencyService,
      { getId: () => 'corr-1' } as unknown as CorrelationIdService,
      {
        recordQueueJob: jest.fn(),
        recordQueueJobDuration: jest.fn(),
      } as unknown as MetricsService,
    );
  });

  it('refunds the buyer the subtotal they paid that seller, then settles', async () => {
    await process(buildJob());

    expect(paymentsLedgerService.openCancellationRefund).toHaveBeenCalledWith(
      expect.anything(),
      { sellerOrderId: 'seller-order-1', amount: 40 },
    );
    // Keyed by refund id: a retried call must not move money twice.
    expect(gateway.refund).toHaveBeenCalledWith(
      expect.objectContaining({ idempotencyKey: 'refund-1', amount: 40 }),
    );
    expect(paymentsLedgerService.settleRefund).toHaveBeenCalledWith(
      'refund-1',
      expect.objectContaining({ gatewayRef: 'mock_re_1', buyerId: 'buyer-1' }),
    );
    expect(paymentsLedgerService.failRefund).not.toHaveBeenCalled();
  });

  // Every SellerOrder status change lands on this queue; only one of
  // them owes anyone money.
  it.each([
    SellerOrderStatus.NEW,
    SellerOrderStatus.PROCESSING,
    SellerOrderStatus.SHIPPED,
    SellerOrderStatus.COMPLETED,
  ])('ignores a %s status change entirely', async (status) => {
    await process(buildJob({ status }));

    expect(paymentsLedgerService.openCancellationRefund).not.toHaveBeenCalled();
    expect(gateway.refund).not.toHaveBeenCalled();
  });

  it('rethrows a declined refund so BullMQ retries, without settling or failing it', async () => {
    gateway.refund.mockRejectedValue(new PaymentGatewayError('declined'));

    await expect(process(buildJob({ attemptsMade: 0 }))).rejects.toBeInstanceOf(
      PaymentGatewayError,
    );
    expect(paymentsLedgerService.settleRefund).not.toHaveBeenCalled();
    expect(paymentsLedgerService.failRefund).not.toHaveBeenCalled();
  });

  // The compensation: the money can't be moved and nothing can undo the
  // cancellation, so the saga records a terminal FAILED state a human
  // can act on rather than dropping it.
  it('escalates to a FAILED refund once the last retry is spent', async () => {
    gateway.refund.mockRejectedValue(new PaymentGatewayError('declined'));

    await expect(
      process(buildJob({ attemptsMade: 4, attempts: 5 })),
    ).resolves.toBeUndefined();

    expect(paymentsLedgerService.failRefund).toHaveBeenCalledWith('refund-1', {
      failureReason: 'declined',
      attempts: 5,
      buyerId: 'buyer-1',
    });
    expect(paymentsLedgerService.settleRefund).not.toHaveBeenCalled();
  });

  // A bug in our own code must not be laundered into "the provider
  // declined" and escalated as if the money were the problem.
  it('lets a non-gateway error fail loudly even on the final attempt', async () => {
    gateway.refund.mockRejectedValue(new TypeError('undefined is not a fn'));

    await expect(
      process(buildJob({ attemptsMade: 4, attempts: 5 })),
    ).rejects.toBeInstanceOf(TypeError);
    expect(paymentsLedgerService.failRefund).not.toHaveBeenCalled();
  });

  it('does not open a second refund when the event is redelivered after settling', async () => {
    eventIdempotency.run.mockResolvedValue('skipped');
    paymentsLedgerService.findRefundForSellerOrder.mockResolvedValue({
      ...REFUND,
      status: RefundStatus.PROCESSED,
    } as never);

    await process(buildJob());

    expect(gateway.refund).not.toHaveBeenCalled();
    expect(paymentsLedgerService.settleRefund).not.toHaveBeenCalled();
  });

  // The crash window: step 1 committed, the process died before the
  // refund settled. Redelivery skips step 1 but must still finish the
  // saga rather than leaving the refund stuck in REQUESTED forever.
  it('resumes a refund left REQUESTED by a crash mid-saga', async () => {
    eventIdempotency.run.mockResolvedValue('skipped');
    paymentsLedgerService.findRefundForSellerOrder.mockResolvedValue(
      REFUND as never,
    );

    await process(buildJob());

    expect(gateway.refund).toHaveBeenCalledWith(
      expect.objectContaining({ idempotencyKey: 'refund-1' }),
    );
    expect(paymentsLedgerService.settleRefund).toHaveBeenCalled();
  });
});
