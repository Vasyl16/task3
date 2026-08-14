export interface AnalyticsPeriodQuery {
  from?: string;
  to?: string;
}

export interface PeriodDescriptor {
  from: string;
  to: string;
  days: number;
}

// Every figure here is a fixed-2-decimal STRING — the Analytics module
// formats money itself rather than relying on Decimal#toJSON (see the
// API contract notes), but it's still not a JS number to do arithmetic
// on in the frontend.
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

export interface PeriodComparison {
  previousPeriod: PeriodDescriptor;
  previous: RevenueSummary & { orders: number };
  netSalesChangePct: number | null;
  platformCommissionChangePct: number | null;
  ordersChangePct: number | null;
}

export interface TopProduct {
  productId: string;
  productName: string;
  sellerId: string;
  unitsSold: number;
  revenue: string;
}

export interface SalesChartPoint {
  date: string;
  netSales: string;
  platformCommission: string;
  orders: number;
}

export interface SellerAnalyticsReport {
  sellerId: string;
  period: PeriodDescriptor;
  revenue: RevenueSummary;
  orders: OrderCounts;
  comparison: PeriodComparison;
  topProducts: TopProduct[];
  salesChart: SalesChartPoint[];
}

export interface TopSeller {
  sellerId: string;
  businessName: string;
  netSales: string;
  platformCommission: string;
  sellerNet: string;
  orderCount: number;
}

export interface PlatformAnalyticsReport {
  period: PeriodDescriptor;
  revenue: RevenueSummary;
  orders: OrderCounts;
  conversion: {
    cartsStarted: number;
    cartsConverted: number;
    rate: number | null;
  };
  comparison: PeriodComparison;
  topProducts: TopProduct[];
  topSellers: TopSeller[];
  salesChart: SalesChartPoint[];
}

export type AnalyticsDataset =
  'summary' | 'sales-chart' | 'top-products' | 'top-sellers';
export type ExportFormat = 'csv' | 'json';

export interface ExportQuery extends AnalyticsPeriodQuery {
  dataset: AnalyticsDataset;
  format?: ExportFormat;
}
