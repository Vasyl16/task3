import { Link, useParams } from 'react-router-dom';
import { useAuctions } from '../../../entities/auction';
import { useProduct } from '../../../entities/product';
import { paths } from '../../../app/routes/paths';
import {
  Alert,
  Card,
  ErrorState,
  PageHeader,
  PageSpinner,
} from '../../../shared/ui';
import {
  ArchiveProductButton,
  EditProductForm,
  ProductImageUpload,
} from '../../../features/seller-products';

// A product can accumulate multiple auctions over its lifetime, each
// re-listed after the last one ends — this is true regardless of
// status/stock, since neither reflects "is there something live to bid
// on right now." See ProductDetailPage's identical check for why a
// COMPLETED/EXPIRED auction doesn't count.
function hasLiveAuction(auctions: { status: string }[] | undefined): boolean {
  return (
    auctions?.some(
      (auction) =>
        auction.status === 'ACTIVE' || auction.status === 'SCHEDULED',
    ) ?? false
  );
}

export function SellerProductEditPage() {
  const { id } = useParams<{ id: string }>();
  const { data: product, error, isPending, refetch } = useProduct(id);
  const { data: auctions } = useAuctions(
    product?.type === 'AUCTION' ? { productId: product.id } : undefined,
  );

  if (isPending) return <PageSpinner label="Loading product" />;
  if (error) return <ErrorState error={error} onRetry={() => void refetch()} />;
  if (!product) return null;

  // Stock existing is not the same as being purchasable: an AUCTION
  // product is only ever bought through an ACTIVE auction, never
  // directly, no matter how much inventory sits behind it.
  const needsNewAuction =
    product.type === 'AUCTION' &&
    product.status === 'ACTIVE' &&
    !hasLiveAuction(auctions);

  return (
    <div>
      <PageHeader title={product.name} />
      {needsNewAuction && (
        <Alert variant="info">
          This listing has no active auction, so buyers can&apos;t bid on or buy
          it right now — its stock just sits unsold until you{' '}
          <Link to={paths.seller.auctions}>create a new auction</Link> for it.
        </Alert>
      )}
      <Card style={{ marginBottom: 'var(--space-4)' }}>
        <ProductImageUpload product={product} />
        <EditProductForm product={product} />
      </Card>
      {product.status !== 'ARCHIVED' && (
        <ArchiveProductButton productId={product.id} />
      )}
    </div>
  );
}
