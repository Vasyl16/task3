import { useMySellerAnalytics } from '../../../entities/analytics';
import { formatMoney } from '../../../shared/lib';
import {
  BarChart,
  Card,
  ErrorState,
  PageSpinner,
  StatTile,
} from '../../../shared/ui';

export function SellerOverviewPage() {
  const { data: report, error, isPending, refetch } = useMySellerAnalytics();

  if (isPending) return <PageSpinner label="Loading your analytics" />;
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
          label="Your net (after commission)"
          value={formatMoney(report.revenue.sellerNet)}
        />
        <StatTile
          label="Orders placed"
          value={String(report.orders.placed)}
          deltaPct={report.comparison.ordersChangePct}
        />
        <StatTile
          label="Orders completed"
          value={String(report.orders.completed)}
        />
        <StatTile
          label="Orders cancelled"
          value={String(report.orders.cancelled)}
        />
      </div>

      <Card>
        <h2 className="ui-section__title">
          Sales, last {report.period.days} days
        </h2>
        <BarChart
          ariaLabel="Net sales per day"
          points={report.salesChart.map((point) => ({
            label: point.date,
            value: Number(point.netSales),
          }))}
          formatValue={(value) => formatMoney(value)}
        />
      </Card>

      {report.topProducts.length > 0 && (
        <div className="ui-section" style={{ marginTop: 'var(--space-6)' }}>
          <h2 className="ui-section__title">Top products</h2>
          <div className="ui-grid">
            {report.topProducts.map((product) => (
              <Card key={product.productId} tight>
                <p style={{ margin: 0, fontWeight: 600 }}>
                  {product.productName}
                </p>
                <p
                  style={{
                    margin: 'var(--space-1) 0 0',
                    color: 'var(--color-text-muted)',
                  }}
                >
                  {product.unitsSold} sold · {formatMoney(product.revenue)}
                </p>
              </Card>
            ))}
          </div>
        </div>
      )}
    </div>
  );
}
