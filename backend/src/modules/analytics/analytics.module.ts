import { Module } from '@nestjs/common';
import { SellersModule } from '../sellers/sellers.module';
import { AnalyticsController } from './analytics.controller';
import { AnalyticsService } from './analytics.service';
import { AnalyticsRepository } from './domain/analytics.repository';
import { PrismaAnalyticsRepository } from './infrastructure/prisma-analytics.repository';

// Imports SellersModule for ONE reason: resolving the caller's own
// SellerProfile so a seller can read their own figures without a
// client-supplied sellerId. No analytics DATA flows through another
// module's service — every figure is aggregated straight from Postgres
// by AnalyticsRepository, which is what keeps this module from turning
// into a hub that every other module has to be wired into.
@Module({
  imports: [SellersModule],
  controllers: [AnalyticsController],
  providers: [
    AnalyticsService,
    { provide: AnalyticsRepository, useClass: PrismaAnalyticsRepository },
  ],
  exports: [AnalyticsService],
})
export class AnalyticsModule {}
