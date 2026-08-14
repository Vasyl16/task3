import { useNavigate, useParams } from 'react-router-dom';
import {
  AuctionCountdown,
  AuctionStatusBadge,
  useAuction,
  useAuctionBids,
  useAuctionRealtime,
} from '../../../entities/auction';
import { useProduct } from '../../../entities/product';
import { SellerOwner, useMySellerProfile } from '../../../entities/seller';
import { paths } from '../../../app/routes/paths';
import { formatDateTime, formatMoney } from '../../../shared/lib';
import {
  Badge,
  Card,
  EmptyState,
  ErrorAlert,
  ErrorState,
  PageSpinner,
  Table,
} from '../../../shared/ui';
import { useAuth } from '../../../features/auth';
import { PlaceBidForm } from '../../../features/bidding';
import { useAuctionCheckout } from '../../../features/checkout';

export function AuctionDetailPage() {
  const { id } = useParams<{ id: string }>();
  const { status } = useAuth();
  const navigate = useNavigate();
  const { data: auction, error, isPending, refetch } = useAuction(id);
  const { data: bids } = useAuctionBids(id);
  const { data: product } = useProduct(auction?.productId);
  // Only meaningful for a SELLER-role viewer; returns null for anyone
  // else. Used purely to grey out the bid form for the auction's own
  // seller — the backend rejects the same bid regardless (see
  // BiddingService.placeBid), this just avoids sending a doomed request.
  const { data: myProfile } = useMySellerProfile();
  const { errorMessage: realtimeError } = useAuctionRealtime(id ?? null);
  const auctionCheckout = useAuctionCheckout(id ?? '');

  if (isPending) return <PageSpinner label="Loading auction" />;
  if (error) return <ErrorState error={error} onRetry={() => void refetch()} />;
  if (!auction) return null;

  // Derived server-side per caller — the winner's identity is never sent
  // to clients, so this is the only thing the page can know.
  const isWinner = auction.status === 'ENDED' && auction.viewerIsHighestBidder;
  const isTopBidder =
    (auction.status === 'ACTIVE' || auction.status === 'SCHEDULED') &&
    auction.viewerIsHighestBidder;
  const isOwnAuction =
    status === 'authenticated' && myProfile?.id === auction.sellerId;

  return (
    <div>
      <Card>
        <div
          style={{
            display: 'flex',
            justifyContent: 'space-between',
            gap: 'var(--space-3)',
          }}
        >
          <h1 style={{ margin: 0 }}>{product?.name ?? 'Auction'}</h1>
          <div
            style={{
              display: 'flex',
              gap: 'var(--space-2)',
              alignItems: 'center',
            }}
          >
            {/* Says only whether YOU hold the top bid. Who else is
                bidding is never sent to the client, so there is nothing
                here that could identify another bidder. */}
            {isTopBidder && (
              <Badge variant="success">You are the top bidder</Badge>
            )}
            <AuctionStatusBadge status={auction.status} />
          </div>
        </div>

        <div style={{ margin: 'var(--space-3) 0' }}>
          <SellerOwner sellerId={auction.sellerId} />
        </div>

        {realtimeError && (
          <p
            style={{ color: 'var(--color-text-muted)', fontSize: '0.8125rem' }}
          >
            Live updates unavailable — refresh for the latest price.
          </p>
        )}

        <div className="ui-stat-grid" style={{ margin: 'var(--space-4) 0' }}>
          <div className="ui-stat">
            <p className="ui-stat__label">Current bid</p>
            <p className="ui-stat__value">
              {auction.currentHighestBid
                ? formatMoney(auction.currentHighestBid)
                : formatMoney(auction.startingPrice)}
            </p>
          </div>
          <div className="ui-stat">
            <p className="ui-stat__label">Minimum increment</p>
            <p className="ui-stat__value">
              {formatMoney(auction.minBidIncrement)}
            </p>
          </div>
          <div className="ui-stat">
            <p className="ui-stat__label">Quantity</p>
            <p className="ui-stat__value">
              {auction.quantity} {auction.quantity === 1 ? 'unit' : 'units'}
            </p>
          </div>
          <div className="ui-stat">
            <p className="ui-stat__label">
              {auction.status === 'ACTIVE' ? 'Time left' : 'Ended'}
            </p>
            <p className="ui-stat__value" style={{ fontSize: '1.125rem' }}>
              <AuctionCountdown
                endsAt={auction.endsAt}
                status={auction.status}
              />
            </p>
          </div>
        </div>

        {isWinner && (
          <Card tight style={{ marginBottom: 'var(--space-4)' }}>
            <ErrorAlert error={auctionCheckout.error} />
            <p>
              <strong>You won this auction.</strong> Complete checkout before
              the window closes
              {auction.checkoutDeadline &&
                ` (${formatDateTime(auction.checkoutDeadline)})`}
              .
            </p>
            <button
              type="button"
              className="ui-button ui-button--primary"
              disabled={auctionCheckout.isPending}
              onClick={() =>
                auctionCheckout.checkout(undefined, {
                  onSuccess: (order) => void navigate(paths.order(order.id)),
                })
              }
            >
              {auctionCheckout.isPending ? 'Placing order…' : 'Checkout now'}
            </button>
          </Card>
        )}

        {isOwnAuction ? (
          <p style={{ color: 'var(--color-text-muted)' }}>
            This is your own auction — you can&apos;t bid on it.
          </p>
        ) : (
          // Keyed by auction id so navigating from one auction straight
          // to another (no full remount of AuctionDetailPage itself,
          // since react-router keeps the same element across a :id-only
          // param change) forces a fresh mount — otherwise PlaceBidForm's
          // RHF defaultValues (its prefilled bid amount) would stay
          // frozen at the PREVIOUS auction's minimum.
          <PlaceBidForm key={auction.id} auction={auction} />
        )}
      </Card>

      <div className="ui-section" style={{ marginTop: 'var(--space-5)' }}>
        <h2 className="ui-section__title">Bid history</h2>
        {!bids || bids.length === 0 ? (
          <EmptyState
            title="No bids yet"
            description="Be the first to bid on this item."
          />
        ) : (
          <Table>
            <thead>
              <tr>
                <th scope="col">Amount</th>
                <th scope="col">Placed</th>
              </tr>
            </thead>
            <tbody>
              {bids.map((bid) => (
                <tr key={bid.id}>
                  <td>{formatMoney(bid.amount)}</td>
                  <td>{formatDateTime(bid.placedAt)}</td>
                </tr>
              ))}
            </tbody>
          </Table>
        )}
      </div>
    </div>
  );
}
