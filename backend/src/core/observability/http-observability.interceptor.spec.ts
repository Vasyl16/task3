import {
  BadRequestException,
  type CallHandler,
  type ExecutionContext,
} from '@nestjs/common';
import { of, throwError } from 'rxjs';
import { MetricsService } from '../../infrastructure/metrics/metrics.service';
import { HttpObservabilityInterceptor } from './http-observability.interceptor';

function buildContext(options: {
  routePath?: string;
  method?: string;
  statusCode?: number;
}): ExecutionContext {
  const request = {
    method: options.method ?? 'GET',
    route: options.routePath ? { path: options.routePath } : undefined,
  };
  const response = { statusCode: options.statusCode ?? 200 };
  return {
    getType: () => 'http',
    switchToHttp: () => ({
      getRequest: () => request,
      getResponse: () => response,
    }),
    getClass: () => ({ name: 'OrdersController' }),
    getHandler: () => ({ name: 'checkout' }),
  } as unknown as ExecutionContext;
}

function handlerReturning(value: unknown): CallHandler {
  return { handle: () => of(value) };
}

function handlerThrowing(err: unknown): CallHandler {
  return { handle: () => throwError(() => err) };
}

describe('HttpObservabilityInterceptor', () => {
  let metrics: MetricsService;
  let interceptor: HttpObservabilityInterceptor;

  beforeEach(() => {
    metrics = new MetricsService();
    interceptor = new HttpObservabilityInterceptor(metrics);
  });

  async function run(
    context: ExecutionContext,
    handler: CallHandler,
  ): Promise<void> {
    await new Promise<void>((resolve) => {
      interceptor.intercept(context, handler).subscribe({
        next: () => resolve(),
        error: () => resolve(),
      });
    });
  }

  it('counts a successful request against its route pattern', async () => {
    await run(
      buildContext({ routePath: '/orders/:id', method: 'GET' }),
      handlerReturning({ id: 'o1' }),
    );

    const rendered = await metrics.render();
    expect(rendered).toContain(
      'http_requests_total{method="GET",route="/orders/:id",status_code="200"} 1',
    );
  });

  // The cardinality guard. Labelling by the concrete URL would mint a
  // new time series per order id; the pattern keeps it to one.
  it('labels by the route pattern, never the concrete URL', async () => {
    await run(buildContext({ routePath: '/orders/:id' }), handlerReturning({}));

    const rendered = await metrics.render();
    expect(rendered).toContain('route="/orders/:id"');
    expect(rendered).not.toContain('route="/orders/9f2c-actual-id"');
  });

  it('derives the status code from the exception, since the filter has not run yet', async () => {
    await run(
      buildContext({ routePath: '/orders/checkout', statusCode: 200 }),
      handlerThrowing(new BadRequestException('Cart is empty')),
    );

    const rendered = await metrics.render();
    expect(rendered).toContain(
      'http_requests_total{method="GET",route="/orders/checkout",status_code="400"} 1',
    );
  });

  it('records the exception class, which is what tells you what actually broke', async () => {
    await run(
      buildContext({ routePath: '/orders/checkout' }),
      handlerThrowing(new BadRequestException('nope')),
    );

    const rendered = await metrics.render();
    expect(rendered).toContain('error_type="BadRequestException"');
  });

  it('treats a non-HttpException as a 500', async () => {
    await run(
      buildContext({ routePath: '/orders/checkout' }),
      handlerThrowing(new Error('database exploded')),
    );

    const rendered = await metrics.render();
    expect(rendered).toContain('status_code="500"');
  });

  it('falls back to Controller.handler when no route pattern is available', async () => {
    await run(buildContext({}), handlerReturning({}));

    const rendered = await metrics.render();
    expect(rendered).toContain('route="OrdersController.checkout"');
  });

  it('ignores non-HTTP contexts, which have their own metrics', async () => {
    const wsContext = {
      getType: () => 'ws',
    } as unknown as ExecutionContext;

    await run(wsContext, handlerReturning({}));

    const rendered = await metrics.render();
    expect(rendered).not.toContain('http_requests_total{');
  });
});
