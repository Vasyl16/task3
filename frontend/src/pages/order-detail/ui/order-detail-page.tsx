import { useParams } from 'react-router-dom';
import {
  OrderStatusBadge,
  OrderItemLines,
  SellerOrderStatusBadge,
  useOrder,
  useOrderRealtime,
} from '../../../entities/order';
import { RaiseDisputeButton } from '../../../features/raise-dispute';
import { formatDateTime, formatMoney } from '../../../shared/lib';
import { Card, ErrorState, PageHeader, PageSpinner } from '../../../shared/ui';

export function OrderDetailPage() {
  const { id } = useParams<{ id: string }>();
  const { data: order, error, isPending, refetch } = useOrder(id);
  useOrderRealtime(id ?? null);

  if (isPending) return <PageSpinner label="Loading order" />;
  if (error) return <ErrorState error={error} onRetry={() => void refetch()} />;
  if (!order) return null;

  return (
    <div>
      <PageHeader
        title={`Order ${order.id.slice(0, 8)}`}
        subtitle={`Placed ${formatDateTime(order.placedAt)}`}
        actions={<OrderStatusBadge status={order.status} />}
      />

      <div className="ui-section">
        <h2 className="ui-section__title">Shipments</h2>
        <p style={{ color: 'var(--color-text-muted)' }}>
          A multi-seller order ships as one independent shipment per seller.
        </p>
        <div
          style={{
            display: 'flex',
            flexDirection: 'column',
            gap: 'var(--space-3)',
          }}
        >
          {order.sellerOrders.map((sellerOrder) => (
            <Card key={sellerOrder.id} tight>
              <div style={{ display: 'flex', justifyContent: 'space-between' }}>
                <span>Seller order {sellerOrder.id.slice(0, 8)}</span>
                <SellerOrderStatusBadge status={sellerOrder.status} />
              </div>
              <p
                style={{
                  margin: 'var(--space-2) 0 0',
                  color: 'var(--color-text-muted)',
                }}
              >
                Subtotal {formatMoney(sellerOrder.subtotal)} + shipping{' '}
                {formatMoney(sellerOrder.shippingFee)}
              </p>
              {/* Per line, because a buyer who ordered four things from
                  one seller should be able to dispute one of them
                  without dragging the other three in. */}
              <ul
                style={{
                  listStyle: 'none',
                  padding: 0,
                  margin: 'var(--space-2) 0 0',
                  display: 'grid',
                  gap: 'var(--space-3)',
                }}
              >
                {(sellerOrder.items ?? []).map((item) => (
                  <li key={item.id}>
                    <OrderItemLines items={[item]} />
                    <RaiseDisputeButton
                      sellerOrderId={sellerOrder.id}
                      orderItemId={item.id}
                      itemName={item.product.name}
                      sellerOrderStatus={sellerOrder.status}
                    />
                  </li>
                ))}
              </ul>

              {/* And one for the shipment as a whole — "nothing arrived"
                  is not a complaint about any single line. */}
              <div style={{ marginTop: 'var(--space-3)' }}>
                <RaiseDisputeButton
                  sellerOrderId={sellerOrder.id}
                  sellerOrderStatus={sellerOrder.status}
                />
              </div>
            </Card>
          ))}
        </div>
      </div>

      <p style={{ fontSize: '1.125rem', fontWeight: 700 }}>
        Total: {formatMoney(order.totalAmount)}
      </p>
    </div>
  );
}
