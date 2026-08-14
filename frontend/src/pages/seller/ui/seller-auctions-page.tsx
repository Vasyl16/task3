import { useState } from 'react';
import { Link, useOutletContext } from 'react-router-dom';
import { AuctionStatusBadge, useAuctions } from '../../../entities/auction';
import { useProducts } from '../../../entities/product';
import type { SellerProfile } from '../../../entities/seller';
import { paths } from '../../../app/routes/paths';
import { formatDateTime, formatMoney } from '../../../shared/lib';
import {
  Button,
  Card,
  EmptyState,
  ErrorState,
  PageHeader,
  PageSpinner,
  Table,
} from '../../../shared/ui';
import { CreateAuctionForm } from '../../../features/seller-auctions';

export function SellerAuctionsPage() {
  // See the comment in seller-layout.tsx: resolved once there, only
  // rendered once approved, so this never fires with a missing sellerId.
  const profile = useOutletContext<SellerProfile>();
  const {
    data: auctions,
    error,
    isPending,
    refetch,
  } = useAuctions({ sellerId: profile.id });
  const { data: products } = useProducts({ sellerId: profile.id });
  const [showForm, setShowForm] = useState(false);

  const auctionableProducts = (products ?? []).filter(
    (product) => product.type === 'AUCTION' && product.status === 'ACTIVE',
  );

  return (
    <div>
      <PageHeader
        title="Your auctions"
        actions={
          <Button
            variant={showForm ? 'secondary' : 'primary'}
            onClick={() => setShowForm((v) => !v)}
          >
            {showForm ? 'Cancel' : 'New auction'}
          </Button>
        }
      />

      {showForm && (
        <Card style={{ marginBottom: 'var(--space-5)' }}>
          <CreateAuctionForm
            auctionableProducts={auctionableProducts}
            onSuccess={() => setShowForm(false)}
          />
        </Card>
      )}

      {isPending && <PageSpinner label="Loading your auctions" />}
      {error && <ErrorState error={error} onRetry={() => void refetch()} />}
      {auctions && auctions.length === 0 && (
        <EmptyState
          title="No auctions yet"
          description="Create one above to get started."
        />
      )}
      {auctions && auctions.length > 0 && (
        <Table>
          <thead>
            <tr>
              <th scope="col">Auction</th>
              <th scope="col">Status</th>
              <th scope="col">Qty</th>
              <th scope="col">Current bid</th>
              <th scope="col">Ends</th>
            </tr>
          </thead>
          <tbody>
            {auctions.map((auction) => (
              <tr key={auction.id}>
                <td>
                  <Link to={paths.auction(auction.id)}>
                    {auction.id.slice(0, 8)}
                  </Link>
                </td>
                <td>
                  <AuctionStatusBadge status={auction.status} />
                </td>
                <td>{auction.quantity}</td>
                <td>
                  {auction.currentHighestBid
                    ? formatMoney(auction.currentHighestBid)
                    : formatMoney(auction.startingPrice)}
                </td>
                <td>{formatDateTime(auction.endsAt)}</td>
              </tr>
            ))}
          </tbody>
        </Table>
      )}
    </div>
  );
}
