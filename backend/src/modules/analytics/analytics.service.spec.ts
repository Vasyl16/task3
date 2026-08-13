import { Test } from '@nestjs/testing';
import { AnalyticsService } from './analytics.service';
import { AnalyticsRepository } from './domain/analytics.repository';
import type {
  ConversionRow,
  LedgerTotalsRow,
  OrderCountsRow,
} from './domain/analytics.repository';

function ledger(overrides: Partial<LedgerTotalsRow> = {}): LedgerTotalsRow {
  return {
    sale: '0',
    commission: '0',
    refund: '0',
    adjustment: '0',
    payout: '0',
    ...overrides,
  };
}

function counts(overrides: Partial<OrderCountsRow> = {}): OrderCountsRow {
  return { placed: 0, completed: 0, cancelled: 0, ...overrides };
}

function conversion(overrides: Partial<ConversionRow> = {}): ConversionRow {
  return { cartsStarted: 0, cartsConverted: 0, ...overrides };
}

describe('AnalyticsService', () => {
  let analyticsService: AnalyticsService;
  let repository: jest.Mocked<AnalyticsRepository>;

  beforeEach(async () => {
    repository = {
      ledgerTotals: jest.fn().mockResolvedValue(ledger()),
      orderCounts: jest.fn().mockResolvedValue(counts()),
      topProducts: jest.fn().mockResolvedValue([]),
      topSellers: jest.fn().mockResolvedValue([]),
      dailySales: jest.fn().mockResolvedValue([]),
      conversion: jest.fn().mockResolvedValue(conversion()),
    };

    const moduleRef = await Test.createTestingModule({
      providers: [
        AnalyticsService,
        { provide: AnalyticsRepository, useValue: repository },
      ],
    }).compile();

    analyticsService = moduleRef.get(AnalyticsService);
  });

  describe('getPlatformReport', () => {
    it('reports commission revenue as a positive figure and its seller counterpart', async () => {
      repository.ledgerTotals.mockResolvedValue(
        ledger({ sale: '2500.00', commission: '-250.00' }),
      );

      const report = await analyticsService.getPlatformReport({
        from: '2026-08-01',
        to: '2026-08-07',
      });

      expect(report.revenue).toEqual({
        netSales: '2500.00',
        platformCommission: '250.00',
        sellerNet: '2250.00',
      });
    });

    // The comparison must be against the immediately preceding window of
    // the same length — otherwise "up 20%" is measured against an
    // arbitrary baseline.
    it('queries the previous period as the equal-length window immediately before', async () => {
      await analyticsService.getPlatformReport({
        from: '2026-08-08',
        to: '2026-08-14',
      });

      const periods = repository.ledgerTotals.mock.calls.map(
        ([period]) => period,
      );
      const current = periods[0];
      const previous = periods[1];

      expect(current.from.toISOString()).toBe('2026-08-08T00:00:00.000Z');
      expect(current.to.toISOString()).toBe('2026-08-15T00:00:00.000Z');
      expect(previous.from.toISOString()).toBe('2026-08-01T00:00:00.000Z');
      expect(previous.to.toISOString()).toBe('2026-08-08T00:00:00.000Z');
    });

    it('computes the change against the previous period', async () => {
      repository.ledgerTotals
        .mockResolvedValueOnce(
          ledger({ sale: '1500.00', commission: '-150.00' }),
        )
        .mockResolvedValueOnce(
          ledger({ sale: '1000.00', commission: '-100.00' }),
        );
      repository.orderCounts
        .mockResolvedValueOnce(counts({ placed: 12 }))
        .mockResolvedValueOnce(counts({ placed: 10 }));

      const report = await analyticsService.getPlatformReport({});

      expect(report.comparison.netSalesChangePct).toBe(50);
      expect(report.comparison.platformCommissionChangePct).toBe(50);
      expect(report.comparison.ordersChangePct).toBe(20);
      expect(report.comparison.previous.netSales).toBe('1000.00');
      expect(report.comparison.previous.orders).toBe(10);
    });

    it('reports the change as null when the previous period had nothing', async () => {
      repository.ledgerTotals
        .mockResolvedValueOnce(ledger({ sale: '900.00', commission: '-90.00' }))
        .mockResolvedValueOnce(ledger());

      const report = await analyticsService.getPlatformReport({});

      expect(report.comparison.netSalesChangePct).toBeNull();
      expect(report.comparison.platformCommissionChangePct).toBeNull();
    });

    it('computes the cart→order conversion rate as a percentage', async () => {
      repository.conversion.mockResolvedValue(
        conversion({ cartsStarted: 40, cartsConverted: 13 }),
      );

      const report = await analyticsService.getPlatformReport({});

      expect(report.conversion).toEqual({
        cartsStarted: 40,
        cartsConverted: 13,
        rate: 32.5,
      });
    });

    // Dividing by zero carts would produce NaN, which serialises to null
    // in JSON anyway but by accident rather than by decision.
    it('reports a null conversion rate when no cart was started', async () => {
      const report = await analyticsService.getPlatformReport({});

      expect(report.conversion.rate).toBeNull();
    });

    it('asks for exactly the top 5 products and sellers', async () => {
      await analyticsService.getPlatformReport({});

      expect(repository.topProducts).toHaveBeenCalledWith(expect.anything(), 5);
      expect(repository.topSellers).toHaveBeenCalledWith(expect.anything(), 5);
    });

    // Each seller row folds through the same foldRevenue as the platform
    // totals, so the columns on the dashboard reconcile with each other.
    it('folds a top-seller row into the same revenue breakdown as the totals', async () => {
      repository.topSellers.mockResolvedValue([
        {
          sellerId: 'seller-1',
          businessName: 'Acme',
          sale: '800.00',
          commission: '-80.00',
          refund: '-100.00',
          adjustment: '10.00',
          orderCount: 4,
        },
      ]);

      const report = await analyticsService.getPlatformReport({});

      expect(report.topSellers[0]).toEqual({
        sellerId: 'seller-1',
        businessName: 'Acme',
        netSales: '700.00',
        platformCommission: '70.00',
        sellerNet: '630.00',
        orderCount: 4,
      });
    });

    it('carries daily chart buckets through unchanged, including empty days', async () => {
      repository.dailySales.mockResolvedValue([
        {
          date: '2026-08-01',
          sale: '100.00',
          commission: '-10.00',
          refund: '0',
          adjustment: '0',
          orders: 2,
        },
        {
          date: '2026-08-02',
          sale: '0',
          commission: '0',
          refund: '0',
          adjustment: '0',
          orders: 0,
        },
      ]);

      const report = await analyticsService.getPlatformReport({});

      expect(report.salesChart).toEqual([
        {
          date: '2026-08-01',
          netSales: '100.00',
          platformCommission: '10.00',
          orders: 2,
        },
        {
          date: '2026-08-02',
          netSales: '0.00',
          platformCommission: '0.00',
          orders: 0,
        },
      ]);
    });
  });

  describe('getSellerReport', () => {
    // Every query must be scoped to the seller. A missed filter here
    // would leak the whole marketplace's revenue to one seller.
    it('scopes every underlying query to the given sellerId', async () => {
      await analyticsService.getSellerReport('seller-42', {});

      for (const call of repository.ledgerTotals.mock.calls) {
        expect(call[1]).toBe('seller-42');
      }
      for (const call of repository.orderCounts.mock.calls) {
        expect(call[1]).toBe('seller-42');
      }
      expect(repository.topProducts).toHaveBeenCalledWith(
        expect.anything(),
        5,
        'seller-42',
      );
      expect(repository.dailySales).toHaveBeenCalledWith(
        expect.anything(),
        'seller-42',
      );
    });

    // Platform-wide top sellers and the cart funnel are marketplace-level
    // figures — a seller has no business seeing either.
    it('never queries top sellers or platform conversion for a seller report', async () => {
      await analyticsService.getSellerReport('seller-42', {});

      expect(repository.topSellers).not.toHaveBeenCalled();
      expect(repository.conversion).not.toHaveBeenCalled();
    });
  });

  describe('exportDataset', () => {
    it('exports the sales chart as CSV with a stable column order', async () => {
      repository.dailySales.mockResolvedValue([
        {
          date: '2026-08-01',
          sale: '100.00',
          commission: '-10.00',
          refund: '0',
          adjustment: '0',
          orders: 2,
        },
      ]);

      const result = await analyticsService.exportDataset({
        dataset: 'sales-chart',
        format: 'csv',
      });

      expect(result.contentType).toContain('text/csv');
      expect(result.body).toBe(
        'date,netSales,platformCommission,orders\r\n2026-08-01,100.00,10.00,2',
      );
    });

    it('names the file after the dataset and the period it covers', async () => {
      const result = await analyticsService.exportDataset({
        dataset: 'top-products',
        format: 'csv',
        from: '2026-08-01',
        to: '2026-08-07',
      });

      expect(result.filename).toBe('top-products_2026-08-01_2026-08-08.csv');
    });

    it('exports the same rows as JSON when asked', async () => {
      repository.topProducts.mockResolvedValue([
        {
          productId: 'product-1',
          productName: 'Widget',
          sellerId: 'seller-1',
          unitsSold: 3,
          revenue: '30.00',
        },
      ]);

      const result = await analyticsService.exportDataset({
        dataset: 'top-products',
        format: 'json',
      });

      expect(result.contentType).toBe('application/json');
      const parsed = JSON.parse(result.body) as {
        rows: Array<{ productId: string; revenue: string }>;
      };
      expect(parsed.rows).toEqual([
        {
          productId: 'product-1',
          productName: 'Widget',
          sellerId: 'seller-1',
          unitsSold: 3,
          revenue: '30.00',
        },
      ]);
    });

    it('exports the summary as metric/value pairs', async () => {
      repository.ledgerTotals.mockResolvedValue(
        ledger({ sale: '500.00', commission: '-50.00' }),
      );

      const result = await analyticsService.exportDataset({
        dataset: 'summary',
        format: 'csv',
      });

      expect(result.body).toContain('metric,value');
      expect(result.body).toContain('platformCommission,50.00');
    });
  });
});
