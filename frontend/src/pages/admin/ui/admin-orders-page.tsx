import { Fragment, useState } from 'react';
import { Link } from 'react-router-dom';
import type { OrderStatus } from '../../../entities/order';
import {
  OrderItemLines,
  OrderStatusBadge,
  SellerOrderStatusBadge,
  useAdminOrders,
} from '../../../entities/order';
import { SellerOrderStatusControl } from '../../../features/seller-orders';
import { paths } from '../../../app/routes/paths';
import { formatDateTime, formatMoney } from '../../../shared/lib';
import {
  Card,
  EmptyState,
  ErrorState,
  PageHeader,
  PageSpinner,
  Pagination,
  Select,
  Table,
  TextField,
} from '../../../shared/ui';

const STATUSES: OrderStatus[] = [
  'NEW',
  'PROCESSING',
  'PARTIALLY_SHIPPED',
  'SHIPPED',
  'COMPLETED',
  'CANCELLED',
];

// The admin order queue. Acting on a shipment reuses the very same
// control a seller uses — the backend admits an admin on that route and
// holds them to the same transitions, so there is no second, subtly
// different set of rules for admins to slip through.
export function AdminOrdersPage() {
  const [status, setStatus] = useState<OrderStatus | ''>('');
  const [search, setSearch] = useState('');
  const [page, setPage] = useState(1);
  const [expanded, setExpanded] = useState<string | null>(null);
  const { data, error, isPending, refetch } = useAdminOrders({
    ...(status ? { status } : {}),
    ...(search.trim() ? { search: search.trim() } : {}),
    page,
  });
  const orders = data?.items;

  return (
    <div>
      <PageHeader
        title="Orders"
        subtitle="Every order on the platform. Expand one to act on a seller's shipment."
      />

      <div
        style={{
          marginBottom: 'var(--space-3)',
          display: 'flex',
          gap: 'var(--space-3)',
          flexWrap: 'wrap',
          alignItems: 'flex-end',
        }}
      >
        <div style={{ minWidth: '20rem', flex: '1 1 20rem' }}>
          <TextField
            label="Search"
            value={search}
            onChange={(event) => {
              setSearch(event.target.value);
              setPage(1);
            }}
            // Matches the order id, the buyer, or a product in it — the
            // three things someone chasing an order actually has.
            placeholder="Order id, buyer email or product name"
          />
        </div>
        <div style={{ maxWidth: '16rem' }}>
          <Select
            label="Status"
            value={status}
            onChange={(event) => {
              setStatus(event.target.value as OrderStatus | '');
              setPage(1);
            }}
          >
            <option value="">All statuses</option>
            {STATUSES.map((value) => (
              <option key={value} value={value}>
                {value}
              </option>
            ))}
          </Select>
        </div>
      </div>

      {isPending && <PageSpinner label="Loading orders" />}
      {error && <ErrorState error={error} onRetry={() => void refetch()} />}

      {orders && orders.length === 0 && (
        <EmptyState
          title="No orders"
          description={
            search.trim()
              ? `Nothing matches “${search.trim()}”.`
              : 'Nothing matches this filter.'
          }
        />
      )}

      {orders && orders.length > 0 && (
        <Table>
          <thead>
            <tr>
              <th scope="col">Order</th>
              <th scope="col">Placed</th>
              <th scope="col">Total</th>
              <th scope="col">Status</th>
              <th scope="col">Action</th>
            </tr>
          </thead>
          <tbody>
            {orders.map((order) => (
              <Fragment key={order.id}>
                <tr>
                  <td>
                    <Link to={paths.order(order.id)}>
                      {order.id.slice(0, 8)}
                    </Link>
                  </td>
                  <td>{formatDateTime(order.placedAt)}</td>
                  <td>{formatMoney(order.totalAmount)}</td>
                  <td>
                    <OrderStatusBadge status={order.status} />
                  </td>
                  <td>
                    <button
                      type="button"
                      className="ui-button ui-button--ghost ui-button--sm"
                      onClick={() =>
                        setExpanded((current) =>
                          current === order.id ? null : order.id,
                        )
                      }
                    >
                      {expanded === order.id ? 'Close' : 'Handle'}
                    </button>
                  </td>
                </tr>
                {expanded === order.id && (
                  <tr>
                    <td colSpan={5}>
                      <div style={{ display: 'grid', gap: 'var(--space-3)' }}>
                        {order.sellerOrders.map((sellerOrder) => (
                          <Card key={sellerOrder.id} tight>
                            <div
                              style={{
                                display: 'flex',
                                justifyContent: 'space-between',
                                gap: 'var(--space-2)',
                              }}
                            >
                              <span>
                                Shipment {sellerOrder.id.slice(0, 8)} ·{' '}
                                {formatMoney(sellerOrder.subtotal)}
                              </span>
                              <SellerOrderStatusBadge
                                status={sellerOrder.status}
                              />
                            </div>
                            <OrderItemLines items={sellerOrder.items} />
                            <div style={{ marginTop: 'var(--space-2)' }}>
                              <SellerOrderStatusControl
                                sellerOrderId={sellerOrder.id}
                                status={sellerOrder.status}
                                isAdmin
                              />
                            </div>
                          </Card>
                        ))}
                      </div>
                    </td>
                  </tr>
                )}
              </Fragment>
            ))}
          </tbody>
        </Table>
      )}

      {data && (
        <Pagination
          page={data.page}
          limit={data.limit}
          total={data.total}
          onPageChange={setPage}
        />
      )}
    </div>
  );
}
