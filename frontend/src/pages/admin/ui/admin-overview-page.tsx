import { useState } from 'react';
import type {
  AnalyticsDataset,
  ExportFormat,
} from '../../../entities/analytics';
import {
  useAdminAnalytics,
  useExportAnalytics,
} from '../../../entities/analytics';
import { formatMoney } from '../../../shared/lib';
import {
  BarChart,
  Button,
  Card,
  ErrorAlert,
  ErrorState,
  PageSpinner,
  Select,
  StatTile,
  Table,
} from '../../../shared/ui';

const DATASETS: { value: AnalyticsDataset; label: string }[] = [
  { value: 'summary', label: 'Summary' },
  { value: 'sales-chart', label: 'Sales chart' },
  { value: 'top-products', label: 'Top products' },
  { value: 'top-sellers', label: 'Top sellers' },
];

export function AdminOverviewPage() {
  const { data: report, error, isPending, refetch } = useAdminAnalytics();
  const exportAnalytics = useExportAnalytics();
  const [dataset, setDataset] = useState<AnalyticsDataset>('summary');
  const [format, setFormat] = useState<ExportFormat>('csv');

  if (isPending) return <PageSpinner label="Loading platform analytics" />;
  if (error) return <ErrorState error={error} onRetry={() => void refetch()} />;
  if (!report) return null;

  return (
    <div>
      <div className="ui-stat-grid" style={{ marginBottom: 'var(--space-6)' }}>
        <StatTile
          label="Net sales (30d)"
          value={formatMoney(report.revenue.netSales)}
          deltaPct={report.comparison.netSalesChangePct}
        />
        <StatTile
          label="Platform commission"
          value={formatMoney(report.revenue.platformCommission)}
          deltaPct={report.comparison.platformCommissionChangePct}
        />
        <StatTile
          label="Orders placed"
          value={String(report.orders.placed)}
          deltaPct={report.comparison.ordersChangePct}
        />
        <StatTile
          label="Cart → order conversion"
          value={
            report.conversion.rate === null
              ? '—'
              : `${report.conversion.rate.toFixed(1)}%`
          }
        />
      </div>

      <Card style={{ marginBottom: 'var(--space-6)' }}>
        <h2 className="ui-section__title">
          Sales, last {report.period.days} days (vs previous period)
        </h2>
        <BarChart
          ariaLabel="Platform net sales per day"
          points={report.salesChart.map((point) => ({
            label: point.date,
            value: Number(point.netSales),
          }))}
          formatValue={(value) => formatMoney(value)}
        />
      </Card>

      <div
        style={{
          display: 'grid',
          gridTemplateColumns: '1fr 1fr',
          gap: 'var(--space-5)',
        }}
      >
        <div>
          <h2 className="ui-section__title">Top products</h2>
          <Table>
            <thead>
              <tr>
                <th scope="col">Product</th>
                <th scope="col">Units</th>
                <th scope="col">Revenue</th>
              </tr>
            </thead>
            <tbody>
              {report.topProducts.map((product) => (
                <tr key={product.productId}>
                  <td>{product.productName}</td>
                  <td>{product.unitsSold}</td>
                  <td>{formatMoney(product.revenue)}</td>
                </tr>
              ))}
            </tbody>
          </Table>
        </div>
        <div>
          <h2 className="ui-section__title">Top sellers</h2>
          <Table>
            <thead>
              <tr>
                <th scope="col">Seller</th>
                <th scope="col">Orders</th>
                <th scope="col">Net sales</th>
              </tr>
            </thead>
            <tbody>
              {report.topSellers.map((seller) => (
                <tr key={seller.sellerId}>
                  <td>{seller.businessName}</td>
                  <td>{seller.orderCount}</td>
                  <td>{formatMoney(seller.netSales)}</td>
                </tr>
              ))}
            </tbody>
          </Table>
        </div>
      </div>

      <Card style={{ marginTop: 'var(--space-6)' }}>
        <h2 className="ui-section__title">Export</h2>
        <ErrorAlert error={exportAnalytics.error} />
        <div
          style={{ display: 'flex', gap: 'var(--space-3)', alignItems: 'end' }}
        >
          <Select
            label="Dataset"
            value={dataset}
            onChange={(event) =>
              setDataset(event.target.value as AnalyticsDataset)
            }
          >
            {DATASETS.map((option) => (
              <option key={option.value} value={option.value}>
                {option.label}
              </option>
            ))}
          </Select>
          <Select
            label="Format"
            value={format}
            onChange={(event) => setFormat(event.target.value as ExportFormat)}
          >
            <option value="csv">CSV</option>
            <option value="json">JSON</option>
          </Select>
          <Button
            isLoading={exportAnalytics.isPending}
            onClick={() => exportAnalytics.mutate({ dataset, format })}
          >
            Download
          </Button>
        </div>
      </Card>
    </div>
  );
}
