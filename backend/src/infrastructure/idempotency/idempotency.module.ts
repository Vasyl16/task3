import { Module } from '@nestjs/common';
import { EventIdempotencyService } from './event-idempotency.service';
import { IdempotencyKeyService } from './idempotency-key.service';
import { IdempotencyInterceptor } from './idempotency.interceptor';

// Two distinct, reusable mechanisms live here — see each service's
// doc-comment for the difference:
//   - EventIdempotencyService: event-CONSUMER idempotency (BullMQ
//     workers), backed by ProcessedEvent.
//   - IdempotencyKeyService (+ IdempotencyInterceptor): API idempotency
//     for client-retried commands, backed by IdempotencyKey.
@Module({
  providers: [
    EventIdempotencyService,
    IdempotencyKeyService,
    IdempotencyInterceptor,
  ],
  exports: [
    EventIdempotencyService,
    IdempotencyKeyService,
    IdempotencyInterceptor,
  ],
})
export class IdempotencyModule {}
