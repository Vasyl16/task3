import { useQueries } from '@tanstack/react-query';
import { Link } from 'react-router-dom';
import { productApi, productKeys } from '../../../entities/product';
import { useCart } from '../../../entities/cart';
import { paths } from '../../../app/routes/paths';
import { formatMoney } from '../../../shared/lib';
import {
  Button,
  EmptyState,
  ErrorState,
  PageHeader,
  PageSpinner,
} from '../../../shared/ui';
import { CartQuantityControl } from '../../../features/cart';

export function CartPage() {
  const { data: cart, error, isPending, refetch } = useCart();

  // CartItem only carries productId/quantity — name and price live on
  // the product itself, so each line's product is fetched in parallel
  // and shares the exact same cache entry the product detail page uses.
  const productQueries = useQueries({
    queries: (cart?.items ?? []).map((item) => ({
      queryKey: productKeys.detail(item.productId),
      queryFn: () => productApi.byId(item.productId),
    })),
  });

  if (isPending) return <PageSpinner label="Loading your cart" />;
  if (error) return <ErrorState error={error} onRetry={() => void refetch()} />;
  if (!cart || cart.items.length === 0) {
    return (
      <EmptyState
        title="Your cart is empty"
        description="Browse the catalog to find something to buy."
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
      <PageHeader title="Your cart" />

      <div
        style={{
          display: 'flex',
          flexDirection: 'column',
          gap: 'var(--space-3)',
        }}
      >
        {lines.map(({ item, product }) => (
          <div
            key={item.productId}
            className="ui-card"
            style={{
              display: 'flex',
              justifyContent: 'space-between',
              alignItems: 'center',
            }}
          >
            <div>
              <p style={{ margin: 0, fontWeight: 600 }}>
                {product ? (
                  <Link to={paths.product(item.productId)}>{product.name}</Link>
                ) : (
                  'Loading…'
                )}
              </p>
              {product && (
                <p style={{ margin: 0, color: 'var(--color-text-muted)' }}>
                  {formatMoney(product.basePrice)} each
                </p>
              )}
            </div>
            <CartQuantityControl
              productId={item.productId}
              quantity={item.quantity}
            />
          </div>
        ))}
      </div>

      <div
        style={{
          display: 'flex',
          justifyContent: 'space-between',
          alignItems: 'center',
          marginTop: 'var(--space-5)',
        }}
      >
        <p style={{ fontSize: '1.25rem', fontWeight: 700, margin: 0 }}>
          Total: {formatMoney(total)}
        </p>
        <Link to={paths.checkout}>
          <Button>Proceed to checkout</Button>
        </Link>
      </div>
    </div>
  );
}
