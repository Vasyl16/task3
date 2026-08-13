import { Global, Module } from '@nestjs/common';
import { MetricsController } from './metrics.controller';
import { MetricsService } from './metrics.service';

// @Global, like PrismaModule: metrics are genuinely cross-cutting —
// checkout, bidding, the outbox relay, every queue consumer and the
// WebSocket gateway all record to them. Making each of those modules
// import this would add wiring noise without making any dependency
// clearer than the injected MetricsService already does.
//
// The per-request HTTP observation lives in CoreModule instead
// (HttpObservabilityInterceptor), since it emits the access log as well
// as the metric.
@Global()
@Module({
  controllers: [MetricsController],
  providers: [MetricsService],
  exports: [MetricsService],
})
export class MetricsModule {}
