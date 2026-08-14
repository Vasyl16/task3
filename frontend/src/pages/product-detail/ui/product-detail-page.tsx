import { Link, useParams } from 'react-router-dom';
import { useAuctions } from '../../../entities/auction';
import { useProduct, useProductStock } from '../../../entities/product';
import { SellerOwner } from '../../../entities/seller';
import { paths } from '../../../app/routes/paths';
import { formatMoney, resolveAssetUrl } from '../../../shared/lib';
import { Badge, Card, ErrorState, PageSpinner } from '../../../shared/ui';
import { AddToCartButton } from '../../../features/cart';

export function ProductDetailPage() {
  const { id } = useParams<{ id: string }>();
  const { data: product, error, isPending, refetch } = useProduct(id);
  const { stock } = useProductStock(id ?? null);
  const { data: auctions } = useAuctions(
    product?.type === 'AUCTION' ? { productId: product.id } : undefined,
  );

  if (isPending) return <PageSpinner label="Loading product" />;
  if (error) return <ErrorState error={error} onRetry={() => void refetch()} />;
  if (!product) return null;

  // A product can accumulate multiple auctions over time (re-listed
  // after one expires/completes) — GET /auctions?productId sorts by
  // endsAt ascending, so `auctions[0]` is the OLDEST one, not the
  // current one. Picking it blindly showed a past (often COMPLETED)
  // auction's stale price/bid data and linked to a page with no bid
  // form, even while a genuinely live auction existed. Only a
  // currently-biddable auction is ever worth linking to here.
  const auction = auctions?.find(
    (candidate) =>
      candidate.status === 'ACTIVE' || candidate.status === 'SCHEDULED',
  );
  const imageUrl = resolveAssetUrl(product.imageUrl);

  return (
    <div>
      <Card>
        {imageUrl ? (
          <img
            src={imageUrl}
            alt={product.name}
            style={{
              width: '100%',
              maxHeight: '360px',
              objectFit: 'cover',
              borderRadius: 'var(--radius)',
              marginBottom: 'var(--space-4)',
            }}
          />
        ) : (
          <div
            aria-hidden="true"
            style={{
              width: '100%',
              height: '220px',
              borderRadius: 'var(--radius)',
              marginBottom: 'var(--space-4)',
              background: 'var(--gradient-brand)',
              display: 'flex',
              alignItems: 'center',
              justifyContent: 'center',
              fontSize: '3.5rem',
              fontWeight: 700,
              color: 'rgba(255, 255, 255, 0.55)',
            }}
          >
            {product.name.charAt(0).toUpperCase()}
          </div>
        )}

        <div
          style={{
            display: 'flex',
            justifyContent: 'space-between',
            gap: 'var(--space-3)',
          }}
        >
          <div>
            <h1 style={{ margin: '0 0 var(--space-2)' }}>{product.name}</h1>
            {product.status !== 'ACTIVE' && (
              <Badge variant="danger">Not available</Badge>
            )}
          </div>
        </div>

        <div style={{ margin: 'var(--space-3) 0' }}>
          <SellerOwner sellerId={product.sellerId} />
        </div>

        {product.description && (
          <p style={{ color: 'var(--color-text-muted)' }}>
            {product.description}
          </p>
        )}

        {product.type === 'FIXED_PRICE' ? (
          <>
            <p style={{ fontSize: '1.5rem', fontWeight: 700 }}>
              {formatMoney(product.basePrice)}
            </p>
            <p style={{ color: 'var(--color-text-muted)' }}>
              {stock === null
                ? 'Checking stock…'
                : stock.quantityAvailable > 0
                  ? `${stock.quantityAvailable} in stock`
                  : 'Out of stock'}
            </p>
            <AddToCartButton product={product} />
          </>
        ) : auction ? (
          <p>
            This item is sold at auction.{' '}
            <Link to={paths.auction(auction.id)}>View the auction</Link>
          </p>
        ) : (
          <p style={{ color: 'var(--color-text-muted)' }}>
            This item is sold at auction — no auction is currently listed for
            it.
          </p>
        )}
      </Card>
    </div>
  );
}
