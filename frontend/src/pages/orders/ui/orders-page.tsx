import { Link } from 'react-router-dom';
import { OrderStatusBadge, useOrders } from '../../../entities/order';
import { paths } from '../../../app/routes/paths';
import { formatDateTime, formatMoney } from '../../../shared/lib';
import {
  EmptyState,
  ErrorState,
  PageHeader,
  PageSpinner,
  Table,
} from '../../../shared/ui';

export function OrdersPage() {
  const { data: orders, error, isPending, refetch } = useOrders();

  return (
    <div>
      <PageHeader title="Order history" />

      {isPending && <PageSpinner label="Loading your orders" />}
      {error && <ErrorState error={error} onRetry={() => void refetch()} />}
      {orders && orders.length === 0 && (
        <EmptyState
          title="No orders yet"
          description="Orders you place will show up here."
          action={<Link to={paths.home}>Browse products</Link>}
        />
      )}
      {orders && orders.length > 0 && (
        <Table>
          <thead>
            <tr>
              <th scope="col">Order</th>
              <th scope="col">Placed</th>
              <th scope="col">Status</th>
              <th scope="col">Total</th>
            </tr>
          </thead>
          <tbody>
            {orders.map((order) => (
              <tr key={order.id}>
                <td>
                  <Link to={paths.order(order.id)}>{order.id.slice(0, 8)}</Link>
                </td>
                <td>{formatDateTime(order.placedAt)}</td>
                <td>
                  <OrderStatusBadge status={order.status} />
                </td>
                <td>{formatMoney(order.totalAmount)}</td>
              </tr>
            ))}
          </tbody>
        </Table>
      )}
    </div>
  );
}
