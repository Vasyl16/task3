import type { CSSProperties } from 'react';
import { Link, useOutletContext } from 'react-router-dom';
import { ProductStatusBadge, useProducts } from '../../../entities/product';
import type { Product } from '../../../entities/product';
import type { SellerProfile } from '../../../entities/seller';
import { paths } from '../../../app/routes/paths';
import { formatMoney, resolveAssetUrl } from '../../../shared/lib';
import {
  Button,
  EmptyState,
  ErrorState,
  PageHeader,
  PageSpinner,
  Table,
} from '../../../shared/ui';

export function SellerProductsPage() {
  // Resolved once by SellerLayout and only rendered once it's a
  // confirmed APPROVED profile — see the comment there. Reading it from
  // route context instead of calling useMySellerProfile() again here is
  // what keeps this query from ever firing with a missing sellerId.
  const profile = useOutletContext<SellerProfile>();
  const {
    data: products,
    error,
    isPending,
    refetch,
  } = useProducts({ sellerId: profile.id });

  return (
    <div>
      <PageHeader
        title="Your products"
        actions={
          <Link to={paths.seller.newProduct}>
            <Button>New product</Button>
          </Link>
        }
      />

      {isPending && <PageSpinner label="Loading your products" />}
      {error && <ErrorState error={error} onRetry={() => void refetch()} />}
      {products && products.length === 0 && (
        <EmptyState
          title="No products yet"
          description="Create your first listing to start selling."
        />
      )}
      {products && products.length > 0 && (
        <Table>
          <thead>
            <tr>
              <th scope="col" aria-hidden="true" />
              <th scope="col">Name</th>
              <th scope="col">Type</th>
              <th scope="col">Price</th>
              <th scope="col">Status</th>
            </tr>
          </thead>
          <tbody>
            {products.map((product) => (
              <tr key={product.id}>
                <td>
                  <ProductThumbnail product={product} />
                </td>
                <td>
                  <Link to={paths.seller.product(product.id)}>
                    {product.name}
                  </Link>
                </td>
                <td>
                  {product.type === 'AUCTION' ? 'Auction' : 'Fixed price'}
                </td>
                <td>{formatMoney(product.basePrice)}</td>
                <td>
                  <ProductStatusBadge status={product.status} />
                </td>
              </tr>
            ))}
          </tbody>
        </Table>
      )}
    </div>
  );
}

function ProductThumbnail({ product }: { product: Product }) {
  const imageUrl = resolveAssetUrl(product.imageUrl);
  const style: CSSProperties = {
    width: 32,
    height: 32,
    borderRadius: 'var(--radius)',
    flexShrink: 0,
  };

  if (imageUrl) {
    return (
      <img src={imageUrl} alt="" style={{ ...style, objectFit: 'cover' }} />
    );
  }
  return (
    <div
      aria-hidden="true"
      style={{
        ...style,
        background: 'var(--gradient-brand)',
        display: 'flex',
        alignItems: 'center',
        justifyContent: 'center',
        color: 'rgba(255, 255, 255, 0.6)',
        fontWeight: 700,
        fontSize: '0.875rem',
      }}
    >
      {product.name.charAt(0).toUpperCase()}
    </div>
  );
}
