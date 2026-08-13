import { Injectable } from '@nestjs/common';
import { AnalyticsRepository } from './domain/analytics.repository';
import type {
  DailySalesRow,
  LedgerTotalsRow,
  TopProductRow,
  TopSellerRow,
} from './domain/analytics.repository';
import {
  AnalyticsPeriod,
  percentChange,
  periodDays,
  previousPeriod,
  resolvePeriod,
} from './domain/period';
import { foldRevenue, formatMoney, money } from './domain/revenue';
import type { LedgerTotals, RevenueBreakdown } from './domain/revenue';
import { toCsv, type CsvRow } from './domain/csv';
import type {
  ConversionSummary,
  PeriodComparison,
  PeriodDescriptor,
  PlatformAnalyticsReport,
  RevenueSummary,
  SalesChartPoint,
  SellerAnalyticsReport,
  TopProduct,
  TopSeller,
} from './domain/analytics-report.interface';
import { AnalyticsPeriodQuery } from './dto/analytics-period.query';
import { AnalyticsDataset, ExportQuery } from './dto/export.query';

// "Top 5" is the number the spec asks for; exposed as a constant because
// the export and the report must not disagree about it.
const TOP_N = 5;

// Reads only. Analytics has no dependency on any other business module —
// it aggregates straight from Postgres (see AnalyticsRepository), which
// is what keeps it from becoming a hub that every module has to be
// wired into.
//
// PostgreSQL is the source of truth for every figure here, and every
// figure is computed live from transactional rows at request time. There
// is no rollup table, no materialized view, and nothing eventually
// consistent in this path — the deliberate trade-off is that a report
// costs real query work instead of being pre-computed, which for an
// admin-facing screen over this data volume is the right side to err on.
@Injectable()
export class AnalyticsService {
  constructor(private readonly analyticsRepository: AnalyticsRepository) {}

  async getPlatformReport(
    query: AnalyticsPeriodQuery = {},
  ): Promise<PlatformAnalyticsReport> {
    const period = resolvePeriod(query);
    const previous = previousPeriod(period);

    // Independent reads, so they overlap rather than queue up.
    const [
      totals,
      orders,
      conversion,
      topProducts,
      topSellers,
      chart,
      previousTotals,
      previousOrders,
    ] = await Promise.all([
      this.analyticsRepository.ledgerTotals(period),
      this.analyticsRepository.orderCounts(period),
      this.analyticsRepository.conversion(period),
      this.analyticsRepository.topProducts(period, TOP_N),
      this.analyticsRepository.topSellers(period, TOP_N),
      this.analyticsRepository.dailySales(period),
      this.analyticsRepository.ledgerTotals(previous),
      this.analyticsRepository.orderCounts(previous),
    ]);

    const revenue = foldRevenue(toLedgerTotals(totals));
    const previousRevenue = foldRevenue(toLedgerTotals(previousTotals));

    return {
      period: describePeriod(period),
      revenue: toRevenueSummary(revenue),
      orders,
      conversion: toConversionSummary(conversion),
      comparison: buildComparison(
        previous,
        revenue,
        orders.placed,
        previousRevenue,
        previousOrders.placed,
      ),
      topProducts: topProducts.map(toTopProduct),
      topSellers: topSellers.map(toTopSeller),
      salesChart: chart.map(toChartPoint),
    };
  }

  // sellerId is resolved from the caller's own SellerProfile by the
  // controller layer — never taken from a query param. See
  // AnalyticsController.getMySellerReport.
  async getSellerReport(
    sellerId: string,
    query: AnalyticsPeriodQuery = {},
  ): Promise<SellerAnalyticsReport> {
    const period = resolvePeriod(query);
    const previous = previousPeriod(period);

    const [totals, orders, topProducts, chart, previousTotals, previousOrders] =
      await Promise.all([
        this.analyticsRepository.ledgerTotals(period, sellerId),
        this.analyticsRepository.orderCounts(period, sellerId),
        this.analyticsRepository.topProducts(period, TOP_N, sellerId),
        this.analyticsRepository.dailySales(period, sellerId),
        this.analyticsRepository.ledgerTotals(previous, sellerId),
        this.analyticsRepository.orderCounts(previous, sellerId),
      ]);

    const revenue = foldRevenue(toLedgerTotals(totals));
    const previousRevenue = foldRevenue(toLedgerTotals(previousTotals));

    return {
      sellerId,
      period: describePeriod(period),
      revenue: toRevenueSummary(revenue),
      orders,
      comparison: buildComparison(
        previous,
        revenue,
        orders.placed,
        previousRevenue,
        previousOrders.placed,
      ),
      topProducts: topProducts.map(toTopProduct),
      salesChart: chart.map(toChartPoint),
    };
  }

  // JSON export is just the report itself — it is already a
  // machine-readable document with stable field names, so a separate
  // serialization would only be a second thing to keep in sync.
  async exportDataset(
    query: ExportQuery,
  ): Promise<{ filename: string; contentType: string; body: string }> {
    const report = await this.getPlatformReport(query);
    const { rows, columns } = selectDatasetRows(report, query.dataset);
    const stamp = `${report.period.from.slice(0, 10)}_${report.period.to.slice(0, 10)}`;
    const filename = `${query.dataset}_${stamp}`;

    if (query.format === 'json') {
      return {
        filename: `${filename}.json`,
        contentType: 'application/json',
        body: JSON.stringify({ period: report.period, rows }, null, 2),
      };
    }
    return {
      filename: `${filename}.csv`,
      contentType: 'text/csv; charset=utf-8',
      body: toCsv(rows, columns),
    };
  }
}

function describePeriod(period: AnalyticsPeriod): PeriodDescriptor {
  return {
    from: period.from.toISOString(),
    to: period.to.toISOString(),
    days: periodDays(period),
  };
}

function toLedgerTotals(row: LedgerTotalsRow): LedgerTotals {
  return {
    sale: money(row.sale),
    commission: money(row.commission),
    refund: money(row.refund),
    adjustment: money(row.adjustment),
    payout: money(row.payout),
  };
}

function toRevenueSummary(revenue: RevenueBreakdown): RevenueSummary {
  return {
    netSales: formatMoney(revenue.netSales),
    platformCommission: formatMoney(revenue.platformCommission),
    sellerNet: formatMoney(revenue.sellerNet),
  };
}

function toConversionSummary(row: {
  cartsStarted: number;
  cartsConverted: number;
}): ConversionSummary {
  return {
    cartsStarted: row.cartsStarted,
    cartsConverted: row.cartsConverted,
    rate:
      row.cartsStarted === 0
        ? null
        : Math.round((row.cartsConverted / row.cartsStarted) * 1000) / 10,
  };
}

function buildComparison(
  previous: AnalyticsPeriod,
  revenue: RevenueBreakdown,
  orders: number,
  previousRevenue: RevenueBreakdown,
  previousOrders: number,
): PeriodComparison {
  return {
    previousPeriod: describePeriod(previous),
    previous: { ...toRevenueSummary(previousRevenue), orders: previousOrders },
    netSalesChangePct: percentChange(
      revenue.netSales.toNumber(),
      previousRevenue.netSales.toNumber(),
    ),
    platformCommissionChangePct: percentChange(
      revenue.platformCommission.toNumber(),
      previousRevenue.platformCommission.toNumber(),
    ),
    ordersChangePct: percentChange(orders, previousOrders),
  };
}

function toTopProduct(row: TopProductRow): TopProduct {
  return {
    productId: row.productId,
    productName: row.productName,
    sellerId: row.sellerId,
    unitsSold: row.unitsSold,
    revenue: formatMoney(money(row.revenue)),
  };
}

// Folded through the same foldRevenue as every other figure, so a
// seller's row here always reconciles with the platform totals.
function toTopSeller(row: TopSellerRow): TopSeller {
  const revenue = foldRevenue({
    sale: money(row.sale),
    commission: money(row.commission),
    refund: money(row.refund),
    adjustment: money(row.adjustment),
    payout: money(0),
  });
  return {
    sellerId: row.sellerId,
    businessName: row.businessName,
    ...toRevenueSummary(revenue),
    orderCount: row.orderCount,
  };
}

function toChartPoint(row: DailySalesRow): SalesChartPoint {
  const revenue = foldRevenue({
    sale: money(row.sale),
    commission: money(row.commission),
    refund: money(row.refund),
    adjustment: money(row.adjustment),
    payout: money(0),
  });
  return {
    date: row.date,
    netSales: formatMoney(revenue.netSales),
    platformCommission: formatMoney(revenue.platformCommission),
    orders: row.orders,
  };
}

// Columns are listed explicitly per dataset rather than inferred, so the
// CSV column order is stable for whatever is consuming it downstream.
function selectDatasetRows(
  report: PlatformAnalyticsReport,
  dataset: AnalyticsDataset,
): { rows: CsvRow[]; columns: string[] } {
  switch (dataset) {
    case 'sales-chart':
      return {
        rows: report.salesChart,
        columns: ['date', 'netSales', 'platformCommission', 'orders'],
      };
    case 'top-products':
      return {
        rows: report.topProducts,
        columns: [
          'productId',
          'productName',
          'sellerId',
          'unitsSold',
          'revenue',
        ],
      };
    case 'top-sellers':
      return {
        rows: report.topSellers,
        columns: [
          'sellerId',
          'businessName',
          'netSales',
          'platformCommission',
          'sellerNet',
          'orderCount',
        ],
      };
    case 'summary':
      return {
        columns: ['metric', 'value'],
        rows: [
          { metric: 'periodFrom', value: report.period.from },
          { metric: 'periodTo', value: report.period.to },
          { metric: 'netSales', value: report.revenue.netSales },
          {
            metric: 'platformCommission',
            value: report.revenue.platformCommission,
          },
          { metric: 'sellerNet', value: report.revenue.sellerNet },
          { metric: 'ordersPlaced', value: report.orders.placed },
          { metric: 'ordersCompleted', value: report.orders.completed },
          { metric: 'ordersCancelled', value: report.orders.cancelled },
          { metric: 'cartsStarted', value: report.conversion.cartsStarted },
          { metric: 'cartsConverted', value: report.conversion.cartsConverted },
          { metric: 'conversionRatePct', value: report.conversion.rate },
          {
            metric: 'netSalesChangePct',
            value: report.comparison.netSalesChangePct,
          },
          {
            metric: 'platformCommissionChangePct',
            value: report.comparison.platformCommissionChangePct,
          },
          {
            metric: 'ordersChangePct',
            value: report.comparison.ordersChangePct,
          },
        ],
      };
  }
}
