import { useState, type CSSProperties } from 'react';
import { Link } from 'react-router-dom';
import { ProductStatusBadge, useMyProducts } from '../../../entities/product';
import { RestoreProductButton } from '../../../features/seller-products';
import type { Product } from '../../../entities/product';
import { paths } from '../../../app/routes/paths';
import { formatMoney, resolveAssetUrl } from '../../../shared/lib';
import {
  Button,
  EmptyState,
  ErrorState,
  PageHeader,
  PageSpinner,
  Pagination,
  Table,
} from '../../../shared/ui';

export function SellerProductsPage() {
  // No sellerId needed any more: /products/mine resolves the seller from
  // the authenticated caller's own approved profile, so there is nothing
  // for a client to get wrong or point at someone else.
  const [page, setPage] = useState(1);
  const {
    data,
    error,
    isPending,
    refetch,
    // Own catalogue, ARCHIVED included — otherwise a seller can never
    // find a listing they took down, let alone put it back.
  } = useMyProducts({ page });
  const products = data?.items;

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
              <th scope="col">Action</th>
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
                <td>
                  {product.status === 'ARCHIVED' && (
                    <RestoreProductButton
                      productId={product.id}
                      moderatedAt={product.moderatedAt}
                    />
                  )}
                </td>
              </tr>
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
