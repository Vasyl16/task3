import { Injectable, NotImplementedException } from '@nestjs/common';
import type { SellerAnalyticsSummary } from './domain/seller-summary.interface';

// Deliberately has NO dependency on other business modules' services —
// analytics reads directly from Postgres (its own repository, once one
// exists) via aggregate queries, rather than calling into eight other
// modules and becoming a dependency hub. Aggregation queries aren't
// designed yet, so this is a stub.
@Injectable()
export class AnalyticsService {
  getSellerSummary(_sellerId: string): Promise<SellerAnalyticsSummary> {
    throw new NotImplementedException('AnalyticsService.getSellerSummary');
  }
}
