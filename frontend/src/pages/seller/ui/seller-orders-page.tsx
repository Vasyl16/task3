import {
  OrderItemLines,
  SellerOrderStatusBadge,
  useMySellerOrders,
} from '../../../entities/order';
import { formatDateTime, formatMoney } from '../../../shared/lib';
import {
  EmptyState,
  ErrorState,
  PageHeader,
  PageSpinner,
  Table,
} from '../../../shared/ui';
import { SellerOrderStatusControl } from '../../../features/seller-orders';

export function SellerOrdersPage() {
  const { data: sellerOrders, error, isPending, refetch } = useMySellerOrders();

  return (
    <div>
      <PageHeader title="Your orders" />

      {isPending && <PageSpinner label="Loading your orders" />}
      {error && <ErrorState error={error} onRetry={() => void refetch()} />}
      {sellerOrders && sellerOrders.length === 0 && (
        <EmptyState
          title="No orders yet"
          description="Orders containing your products will show up here."
        />
      )}
      {sellerOrders && sellerOrders.length > 0 && (
        <Table>
          <thead>
            <tr>
              <th scope="col">Order</th>
              <th scope="col">Items</th>
              <th scope="col">Placed</th>
              <th scope="col">Subtotal</th>
              <th scope="col">Status</th>
              <th scope="col">Action</th>
            </tr>
          </thead>
          <tbody>
            {sellerOrders.map((sellerOrder) => (
              <tr key={sellerOrder.id}>
                <td>{sellerOrder.order.id.slice(0, 8)}</td>
                <td>
                  <OrderItemLines items={sellerOrder.items} />
                </td>
                <td>{formatDateTime(sellerOrder.order.placedAt)}</td>
                <td>{formatMoney(sellerOrder.subtotal)}</td>
                <td>
                  <SellerOrderStatusBadge status={sellerOrder.status} />
                </td>
                <td>
                  <SellerOrderStatusControl
                    sellerOrderId={sellerOrder.id}
                    status={sellerOrder.status}
                  />
                </td>
              </tr>
            ))}
          </tbody>
        </Table>
      )}
    </div>
  );
}
