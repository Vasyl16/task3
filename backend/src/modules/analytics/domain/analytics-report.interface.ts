// Wire shapes. Every money value is a fixed-2 decimal STRING, never a
// JS number — a number would be parsed back as a float by the client and
// reintroduce exactly the precision loss the Decimal arithmetic avoids.

export interface PeriodDescriptor {
  // ISO instants. `from` is inclusive, `to` exclusive.
  from: string;
  to: string;
  days: number;
}

export interface RevenueSummary {
  netSales: string;
  platformCommission: string;
  sellerNet: string;
}

export interface OrderCounts {
  placed: number;
  completed: number;
  cancelled: number;
}

export interface ConversionSummary {
  cartsStarted: number;
  cartsConverted: number;
  // 0–100, one decimal. null when no cart was started in the period.
  rate: number | null;
}

export type TopProduct = {
  productId: string;
  productName: string;
  sellerId: string;
  unitsSold: number;
  revenue: string;
};

export type TopSeller = {
  sellerId: string;
  businessName: string;
  netSales: string;
  platformCommission: string;
  sellerNet: string;
  orderCount: number;
};

export type SalesChartPoint = {
  // YYYY-MM-DD, one entry per UTC day, gaps included as zeroes.
  date: string;
  netSales: string;
  platformCommission: string;
  orders: number;
};

// null where the previous period had nothing to compare against — see
// percentChange in period.ts.
export interface PeriodComparison {
  previousPeriod: PeriodDescriptor;
  previous: RevenueSummary & { orders: number };
  netSalesChangePct: number | null;
  platformCommissionChangePct: number | null;
  ordersChangePct: number | null;
}

export interface PlatformAnalyticsReport {
  period: PeriodDescriptor;
  revenue: RevenueSummary;
  orders: OrderCounts;
  conversion: ConversionSummary;
  comparison: PeriodComparison;
  topProducts: TopProduct[];
  topSellers: TopSeller[];
  salesChart: SalesChartPoint[];
}

export interface SellerAnalyticsReport {
  sellerId: string;
  period: PeriodDescriptor;
  revenue: RevenueSummary;
  orders: OrderCounts;
  comparison: Omit<PeriodComparison, 'previous'> & {
    previous: RevenueSummary & { orders: number };
  };
  topProducts: TopProduct[];
  salesChart: SalesChartPoint[];
}
