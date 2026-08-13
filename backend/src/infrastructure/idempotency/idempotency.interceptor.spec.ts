import {
  UnauthorizedException,
  type CallHandler,
  type ExecutionContext,
} from '@nestjs/common';
import { Observable, of } from 'rxjs';
import { IdempotencyInterceptor } from './idempotency.interceptor';
import type { IdempotencyKeyService } from './idempotency-key.service';

function buildContext(overrides: {
  header?: string;
  user?: { id: string };
  body?: unknown;
}): { context: ExecutionContext; setStatus: jest.Mock } {
  const setStatus = jest.fn();
  const request = {
    header: (name: string) =>
      name.toLowerCase() === 'idempotency-key' ? overrides.header : undefined,
    user: overrides.user,
    method: 'POST',
    originalUrl: '/orders/checkout',
    body: overrides.body ?? {},
  };
  const response = { status: setStatus, statusCode: 201 };
  const context = {
    switchToHttp: () => ({
      getRequest: () => request,
      getResponse: () => response,
    }),
  } as unknown as ExecutionContext;
  return { context, setStatus };
}

function buildHandler(result: unknown): CallHandler {
  return { handle: jest.fn(() => of(result)) };
}

describe('IdempotencyInterceptor', () => {
  let begin: jest.Mock;
  let complete: jest.Mock;
  let release: jest.Mock;
  let interceptor: IdempotencyInterceptor;

  beforeEach(() => {
    begin = jest.fn();
    complete = jest.fn().mockResolvedValue(undefined);
    release = jest.fn().mockResolvedValue(undefined);
    interceptor = new IdempotencyInterceptor({
      begin,
      complete,
      release,
    } as unknown as IdempotencyKeyService);
  });

  it('passes requests through unaffected when no Idempotency-Key header is present', (done) => {
    const { context } = buildContext({ user: { id: 'buyer-1' } });
    const handler = buildHandler({ orderId: 'order-1' });

    interceptor.intercept(context, handler).subscribe((result) => {
      expect(result).toEqual({ orderId: 'order-1' });
      expect(handler.handle).toHaveBeenCalled();
      expect(begin).not.toHaveBeenCalled();
      done();
    });
  });

  it('requires authentication to use an Idempotency-Key', () => {
    const { context } = buildContext({ header: 'key-1' }); // no user
    const handler = buildHandler({});

    expect(() => interceptor.intercept(context, handler)).toThrow(
      UnauthorizedException,
    );
  });

  // Duplicate checkout/bid request: the first call runs the handler and
  // records the result; a second call with the SAME key never invokes
  // the handler again — it gets the stored response instead. This is
  // the mechanism both OrdersController.checkout and
  // BiddingController.placeBid rely on via @UseInterceptors.
  it('does not invoke the handler a second time for a duplicate request with the same key', (done) => {
    begin.mockResolvedValueOnce({ outcome: 'proceed' });
    const first = buildContext({ header: 'key-1', user: { id: 'buyer-1' } });
    const firstHandler = buildHandler({ orderId: 'order-1' });

    interceptor.intercept(first.context, firstHandler).subscribe(() => {
      expect(complete).toHaveBeenCalledWith('key-1', 'buyer-1', 201, {
        orderId: 'order-1',
      });

      begin.mockResolvedValueOnce({
        outcome: 'replay',
        responseStatus: 201,
        responseBody: { orderId: 'order-1' },
      });
      const second = buildContext({ header: 'key-1', user: { id: 'buyer-1' } });
      const secondHandler = buildHandler({ orderId: 'SHOULD-NOT-HAPPEN' });

      interceptor
        .intercept(second.context, secondHandler)
        .subscribe((result) => {
          expect(result).toEqual({ orderId: 'order-1' }); // the ORIGINAL result
          expect(secondHandler.handle).not.toHaveBeenCalled();
          expect(second.setStatus).toHaveBeenCalledWith(201);
          done();
        });
    });
  });

  it('releases the idempotency marker if the handler throws, so a real retry is not stuck', (done) => {
    begin.mockResolvedValueOnce({ outcome: 'proceed' });
    const { context } = buildContext({
      header: 'key-1',
      user: { id: 'buyer-1' },
    });
    const handler: CallHandler = {
      handle: () =>
        new Observable((subscriber) => {
          subscriber.error(new Error('insufficient stock'));
        }),
    };

    interceptor.intercept(context, handler).subscribe({
      error: (err: Error) => {
        expect(err.message).toBe('insufficient stock');
        expect(release).toHaveBeenCalledWith('key-1', 'buyer-1');
        done();
      },
    });
  });
});
