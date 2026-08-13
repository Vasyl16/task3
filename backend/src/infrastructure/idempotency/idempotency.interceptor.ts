import {
  CallHandler,
  ExecutionContext,
  Injectable,
  NestInterceptor,
  UnauthorizedException,
} from '@nestjs/common';
import type { Request, Response } from 'express';
import { Observable, from, of } from 'rxjs';
import { catchError, switchMap, tap } from 'rxjs/operators';
import type { AuthenticatedUser } from '../../core/auth/authenticated-user.interface';
import { IdempotencyKeyService } from './idempotency-key.service';
import { hashRequest } from './request-hash';

const HEADER = 'idempotency-key';

// Opt-in adapter: a future command endpoint (checkout/refund/bid) adds
// `@UseInterceptors(IdempotencyInterceptor)`. Requests without the
// header pass straight through unaffected — this is not a global
// interceptor. Keeps the actual Idempotency-Key mechanics
// (IdempotencyKeyService) reusable and testable independent of HTTP.
@Injectable()
export class IdempotencyInterceptor implements NestInterceptor {
  constructor(private readonly idempotencyKeyService: IdempotencyKeyService) {}

  intercept(context: ExecutionContext, next: CallHandler): Observable<unknown> {
    const request = context
      .switchToHttp()
      .getRequest<Request & { user?: AuthenticatedUser }>();
    const key = request.header(HEADER);
    if (!key) {
      return next.handle();
    }

    const userId = request.user?.id;
    if (!userId) {
      throw new UnauthorizedException(
        'Idempotency-Key requires an authenticated request',
      );
    }
    const requestHash = hashRequest(
      request.method,
      request.originalUrl,
      request.body,
    );

    return from(
      this.idempotencyKeyService.begin(key, userId, requestHash),
    ).pipe(
      switchMap((begin) => {
        if (begin.outcome === 'replay') {
          const response = context.switchToHttp().getResponse<Response>();
          response.status(begin.responseStatus);
          return of(begin.responseBody);
        }
        return next.handle().pipe(
          tap((body: unknown) => {
            const response = context.switchToHttp().getResponse<Response>();
            void this.idempotencyKeyService.complete(
              key,
              userId,
              response.statusCode,
              body,
            );
          }),
          catchError((err: unknown) => {
            return from(this.idempotencyKeyService.release(key, userId)).pipe(
              switchMap(() => {
                throw err;
              }),
            );
          }),
        );
      }),
    );
  }
}
