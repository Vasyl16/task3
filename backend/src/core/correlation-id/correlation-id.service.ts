import { Injectable } from '@nestjs/common';
import { AsyncLocalStorage } from 'node:async_hooks';

interface CorrelationContext {
  correlationId: string;
}

// Set once per request/connection by CorrelationIdMiddleware; readable
// anywhere downstream in that call chain without threading it through
// every function signature.
@Injectable()
export class CorrelationIdService {
  private readonly als = new AsyncLocalStorage<CorrelationContext>();

  run<T>(correlationId: string, fn: () => T): T {
    return this.als.run({ correlationId }, fn);
  }

  getId(): string | undefined {
    return this.als.getStore()?.correlationId;
  }
}
