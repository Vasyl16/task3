import { useQueries } from '@tanstack/react-query';
import { Link, useNavigate } from 'react-router-dom';
import { productApi, productKeys } from '../../../entities/product';
import { useCart } from '../../../entities/cart';
import { paths } from '../../../app/routes/paths';
import { formatMoney } from '../../../shared/lib';
import {
  Button,
  Card,
  EmptyState,
  ErrorAlert,
  PageHeader,
  PageSpinner,
} from '../../../shared/ui';
import { useCartCheckout } from '../../../features/checkout';

// Deliberately re-fetches the cart rather than trusting whatever the
// cart page last showed — the backend re-validates stock and price from
// scratch at checkout regardless, and this page should reflect the same
// authoritative state it's about to submit against.
export function CheckoutPage() {
  const navigate = useNavigate();
  const { data: cart, isPending } = useCart();
  const { checkout, isPending: isCheckingOut, error } = useCartCheckout();

  const productQueries = useQueries({
    queries: (cart?.items ?? []).map((item) => ({
      queryKey: productKeys.detail(item.productId),
      queryFn: () => productApi.byId(item.productId),
    })),
  });

  if (isPending) return <PageSpinner label="Loading your order" />;
  if (!cart || cart.items.length === 0) {
    return (
      <EmptyState
        title="Your cart is empty"
        description="Add something to your cart before checking out."
        action={<Link to={paths.home}>Browse products</Link>}
      />
    );
  }

  const lines = cart.items.map((item, index) => ({
    item,
    product: productQueries[index]?.data,
  }));
  const total = lines.reduce(
    (sum, { item, product }) =>
      sum + (product ? Number(product.basePrice) * item.quantity : 0),
    0,
  );

  return (
    <div>
      <PageHeader title="Checkout" />

      <Card>
        <ErrorAlert error={error} />
        {lines.map(({ item, product }) => (
          <div
            key={item.productId}
            style={{
              display: 'flex',
              justifyContent: 'space-between',
              padding: 'var(--space-2) 0',
            }}
          >
            <span>
              {product?.name ?? 'Loading…'} × {item.quantity}
            </span>
            <span>
              {product &&
                formatMoney(Number(product.basePrice) * item.quantity)}
            </span>
          </div>
        ))}
        <div
          style={{
            display: 'flex',
            justifyContent: 'space-between',
            fontWeight: 700,
            fontSize: '1.125rem',
            borderTop: '1px solid var(--color-border)',
            marginTop: 'var(--space-3)',
            paddingTop: 'var(--space-3)',
          }}
        >
          <span>Total</span>
          <span>{formatMoney(total)}</span>
        </div>

        <p style={{ color: 'var(--color-text-muted)', fontSize: '0.875rem' }}>
          Prices and stock are re-checked by the server at the moment your order
          is placed — this total may change if something sold out in the
          meantime.
        </p>

        <Button
          isLoading={isCheckingOut}
          onClick={() =>
            checkout(undefined, {
              onSuccess: (order) => void navigate(paths.order(order.id)),
            })
          }
        >
          Place order
        </Button>
      </Card>
    </div>
  );
}
