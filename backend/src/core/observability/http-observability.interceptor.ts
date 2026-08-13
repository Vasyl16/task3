import {
  CallHandler,
  ExecutionContext,
  HttpException,
  Injectable,
  Logger,
  NestInterceptor,
} from '@nestjs/common';
import type { Request, Response } from 'express';
import { Observable, tap } from 'rxjs';
import { MetricsService } from '../../infrastructure/metrics/metrics.service';
import type { AuthenticatedUser } from '../auth/authenticated-user.interface';

// Registered globally (see CoreModule). One pass per request, producing
// BOTH the Prometheus observation and the structured access-log line —
// they need identical metadata (route pattern, status, duration,
// caller), and deriving it twice would risk the two disagreeing about
// the very thing that makes them comparable.
//
// The `route` label/field is the route PATTERN (`/orders/:id`), never
// the concrete URL (`/orders/9f2c...`). For metrics that distinction is
// the difference between a usable time series and a cardinality
// explosion — one series per order id would overwhelm Prometheus within
// a day. The log line uses the same value so a Grafana panel can pivot
// between the two on one field.
//
// correlationId is deliberately absent from the log call: AppLogger
// reads it from the AsyncLocalStorage context CorrelationIdMiddleware
// established for this request.
@Injectable()
export class HttpObservabilityInterceptor implements NestInterceptor {
  private readonly logger = new Logger('Http');

  constructor(private readonly metrics: MetricsService) {}

  intercept(context: ExecutionContext, next: CallHandler): Observable<unknown> {
    if (context.getType() !== 'http') {
      // WebSocket traffic has its own metrics — see RealtimeGateway.
      return next.handle();
    }

    const http = context.switchToHttp();
    const request = http.getRequest<Request>();
    const response = http.getResponse<Response>();
    const route = this.resolveRoute(context, request);
    const method = request.method;
    const startedAt = process.hrtime.bigint();

    const record = (statusCode: number, error?: unknown) => {
      const seconds = Number(process.hrtime.bigint() - startedAt) / 1e9;
      this.metrics.recordHttpRequest(method, route, statusCode, seconds);

      // userId only when the request authenticated — never a
      // client-supplied value; req.user is populated by JwtAuthGuard
      // from the verified token.
      const user = (request as Request & { user?: AuthenticatedUser }).user;
      const fields: Record<string, unknown> = {
        event: 'http.request',
        method,
        route,
        statusCode,
        durationMs: Math.round(seconds * 1000),
        userId: user?.id,
      };

      if (error) {
        const errorType =
          error instanceof Error ? error.constructor.name : 'UnknownError';
        this.metrics.recordHttpError(method, route, statusCode, errorType);
        // Raw, not pre-serialized: AppLogger owns error serialization,
        // and doing it here too would nest one inside the other.
        fields.error = error;
      }

      // 5xx is the system failing; 4xx is usually a client or business
      // rule doing its job, so it must not page anyone.
      if (statusCode >= 500) {
        this.logger.error(fields);
      } else if (statusCode >= 400) {
        this.logger.warn(fields);
      } else {
        this.logger.log(fields);
      }
    };

    return next.handle().pipe(
      tap({
        next: () => record(response.statusCode),
        error: (err: unknown) => {
          // The exception filter hasn't run yet, so response.statusCode
          // is still the default — derive it from the exception instead.
          const statusCode =
            err instanceof HttpException ? err.getStatus() : 500;
          record(statusCode, err);
        },
      }),
    );
  }

  // Express fills req.route once routing has matched, which is the
  // cleanest source of the pattern. The Controller.handler fallback
  // covers anything that never reached a route (and is equally
  // low-cardinality).
  private resolveRoute(context: ExecutionContext, request: Request): string {
    const routePath = (request.route as { path?: string } | undefined)?.path;
    if (routePath) {
      return routePath;
    }
    return `${context.getClass().name}.${context.getHandler().name}`;
  }
}
