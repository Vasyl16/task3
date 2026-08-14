import { useQueries } from '@tanstack/react-query';
import { Link } from 'react-router-dom';
import {
  AuctionStatusBadge,
  useMyAuctions,
  type Auction,
} from '../../../entities/auction';
import { productApi, productKeys } from '../../../entities/product';
import { paths } from '../../../app/routes/paths';
import { useAuth } from '../../../features/auth';
import { formatDateTime, formatMoney } from '../../../shared/lib';
import {
  Badge,
  EmptyState,
  ErrorState,
  PageHeader,
  PageSpinner,
  Table,
} from '../../../shared/ui';

// Winning/Outbid only apply while bidding is still open; once it's over
// the only two outcomes for a bidder are Won/Lost — COMPLETED (checked
// out) is shown via its own status badge instead, since "Won" alone
// would hide that the order was already placed.
function myOutcome(auction: Auction): string | null {
  const isHighBidder = auction.viewerIsHighestBidder;
  switch (auction.status) {
    case 'ACTIVE':
    case 'SCHEDULED':
      return isHighBidder ? 'Winning' : 'Outbid';
    case 'ENDED':
      return isHighBidder ? 'Won — checkout open' : 'Lost';
    case 'EXPIRED':
      return isHighBidder ? 'Won — checkout window missed' : 'Lost';
    case 'COMPLETED':
    case 'CANCELLED':
      return null;
  }
}

export function MyAuctionsPage() {
  const { user } = useAuth();
  const { data: auctions, error, isPending, refetch } = useMyAuctions();

  const productQueries = useQueries({
    queries: (auctions ?? []).map((auction) => ({
      queryKey: productKeys.detail(auction.productId),
      queryFn: () => productApi.byId(auction.productId),
    })),
  });

  return (
    <div>
      <PageHeader
        title="My auctions"
        subtitle="Every auction you've placed a bid on."
      />

      {isPending && <PageSpinner label="Loading your auctions" />}
      {error && <ErrorState error={error} onRetry={() => void refetch()} />}
      {auctions && auctions.length === 0 && (
        <EmptyState
          title="No auctions yet"
          description="Auctions you bid on will show up here."
          action={<Link to={paths.home}>Browse auctions</Link>}
        />
      )}
      {auctions && auctions.length > 0 && user && (
        <Table>
          <thead>
            <tr>
              <th scope="col">Item</th>
              <th scope="col">Status</th>
              <th scope="col">Outcome</th>
              <th scope="col">Qty</th>
              <th scope="col">Current bid</th>
              <th scope="col">Ends</th>
            </tr>
          </thead>
          <tbody>
            {auctions.map((auction, index) => {
              const outcome = myOutcome(auction);
              return (
                <tr key={auction.id}>
                  <td>
                    <Link to={paths.auction(auction.id)}>
                      {productQueries[index]?.data?.name ??
                        auction.id.slice(0, 8)}
                    </Link>
                  </td>
                  <td>
                    <AuctionStatusBadge status={auction.status} />
                  </td>
                  <td>
                    {outcome && (
                      <Badge
                        variant={
                          outcome.startsWith('Won') || outcome === 'Winning'
                            ? 'success'
                            : 'neutral'
                        }
                      >
                        {outcome}
                      </Badge>
                    )}
                  </td>
                  <td>{auction.quantity}</td>
                  <td>
                    {auction.currentHighestBid
                      ? formatMoney(auction.currentHighestBid)
                      : formatMoney(auction.startingPrice)}
                  </td>
                  <td>{formatDateTime(auction.endsAt)}</td>
                </tr>
              );
            })}
          </tbody>
        </Table>
      )}
    </div>
  );
}
