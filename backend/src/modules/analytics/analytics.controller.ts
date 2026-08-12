import { Controller, Get, Param } from '@nestjs/common';
import { AnalyticsService } from './analytics.service';

// TODO(auth): restrict to the owning seller or ADMIN once guards exist.
@Controller('analytics')
export class AnalyticsController {
  constructor(private readonly analyticsService: AnalyticsService) {}

  @Get('sellers/:sellerId/summary')
  getSellerSummary(@Param('sellerId') sellerId: string) {
    return this.analyticsService.getSellerSummary(sellerId);
  }
}
