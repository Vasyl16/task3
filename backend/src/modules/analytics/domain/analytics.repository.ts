import type { AnalyticsPeriod } from './period';

// Rows come back with money as decimal STRINGS (Postgres `numeric` cast
// to text) rather than JS numbers, so nothing is rounded between the
// database and the Decimal arithmetic in revenue.ts.
export interface LedgerTotalsRow {
  sale: string;
  commission: string;
  refund: string;
  adjustment: string;
  payout: string;
}

export interface OrderCountsRow {
  placed: number;
  completed: number;
  cancelled: number;
}

export interface TopProductRow {
  productId: string;
  productName: string;
  sellerId: string;
  unitsSold: number;
  revenue: string;
}

export interface TopSellerRow {
  sellerId: string;
  businessName: string;
  sale: string;
  commission: string;
  refund: string;
  adjustment: string;
  orderCount: number;
}

export interface DailySalesRow {
  date: string;
  sale: string;
  commission: string;
  refund: string;
  adjustment: string;
  orders: number;
}

export interface ConversionRow {
  cartsStarted: number;
  cartsConverted: number;
}

// Analytics reads Postgres directly through aggregate queries rather than
// calling into eight other modules' services — see the
// backend-architecture skill's dependency diagram, where analytics is
// deliberately standalone. It only ever READS; it owns no writes.
//
// There are no pre-aggregated rollup tables behind any of this. Every
// figure is summed live from the transactional rows (LedgerEntry,
// OrderItem, Order, CartSession), so a reported number cannot drift from
// the data it claims to describe.
export abstract class AnalyticsRepository {
  abstract ledgerTotals(
    period: AnalyticsPeriod,
    sellerId?: string,
  ): Promise<LedgerTotalsRow>;

  abstract orderCounts(
    period: AnalyticsPeriod,
    sellerId?: string,
  ): Promise<OrderCountsRow>;

  abstract topProducts(
    period: AnalyticsPeriod,
    limit: number,
    sellerId?: string,
  ): Promise<TopProductRow[]>;

  abstract topSellers(
    period: AnalyticsPeriod,
    limit: number,
  ): Promise<TopSellerRow[]>;

  // One row per UTC day across the whole period, including days with no
  // activity.
  abstract dailySales(
    period: AnalyticsPeriod,
    sellerId?: string,
  ): Promise<DailySalesRow[]>;

  abstract conversion(period: AnalyticsPeriod): Promise<ConversionRow>;
}
