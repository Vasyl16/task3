import { Global, MiddlewareConsumer, Module, NestModule } from '@nestjs/common';
import { CorrelationIdMiddleware } from './correlation-id/correlation-id.middleware';
import { CorrelationIdService } from './correlation-id/correlation-id.service';

// Global: CorrelationIdService is injectable anywhere without importing
// this module. Next up here: structured logging, global exception filter.
@Global()
@Module({
  providers: [CorrelationIdService, CorrelationIdMiddleware],
  exports: [CorrelationIdService],
})
export class CoreModule implements NestModule {
  configure(consumer: MiddlewareConsumer) {
    consumer.apply(CorrelationIdMiddleware).forRoutes('*');
  }
}
