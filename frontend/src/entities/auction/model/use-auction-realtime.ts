import { useQueryClient } from '@tanstack/react-query';
import { useRealtimeRoom } from '../../../shared/realtime';
import { auctionKeys } from '../api/auction-api';
import type { Auction, AuctionStatus } from './auction';

// Snapshot shape for the `auction:{id}` room — overlaps with, but isn't
// identical to, the REST Auction (no sellerId/createdAt/updatedAt; `id`
// is named `auctionId` here). Only the fields both shapes share are
// patched into the query cache — everything else keeps whatever the
// last REST fetch returned.
interface AuctionSnapshotState {
  auctionId: string;
  productId: string;
  status: AuctionStatus;
  startingPrice: string;
  minBidIncrement: string;
  currentHighestBid: string | null;
  version: number;
  startsAt: string;
  endsAt: string;
  checkoutDeadline: string | null;
}

// No bidderId / winningBidderId: an auction room broadcasts to everyone
// watching the lot, so the backend strips bidder identities before they
// go out (see RealtimeConsumer.withoutBidderIdentity). Whether the
// VIEWER holds the top bid is per-caller and comes from the REST
// projection instead — which is why every handler below re-fetches the
// auction rather than trying to patch that flag from a broadcast.
interface BidUpdatedPayload {
  auctionId: string;
  bidId: string;
  amount: number;
}

interface AuctionEndedPayload {
  auctionId: string;
  winningAmount: string | null;
}

// Keeps an already-fetched auction detail query live: patches price/
// status fields as bids land and the auction ends, and re-pulls the bid
// history whenever the room is (re)subscribed — including after a
// dropped connection, since a missed 'auction.bid.updated' broadcast
// during a disconnect must not leave the visible price wrong.
export function useAuctionRealtime(auctionId: string | null) {
  const queryClient = useQueryClient();

  return useRealtimeRoom<
    AuctionSnapshotState,
    BidUpdatedPayload | AuctionEndedPayload
  >(auctionId ? `auction:${auctionId}` : null, {
    events: ['auction.bid.updated', 'auction.ended'],
    onSnapshot: (state) => {
      queryClient.setQueryData<Auction>(
        auctionKeys.detail(state.auctionId),
        (current) =>
          current && {
            ...current,
            status: state.status,
            currentHighestBid: state.currentHighestBid,
            version: state.version,
            checkoutDeadline: state.checkoutDeadline,
          },
      );
      void queryClient.invalidateQueries({
        queryKey: auctionKeys.bids(state.auctionId),
      });
      // viewerIsHighestBidder cannot be derived from a room broadcast,
      // so refresh it from the per-caller endpoint.
      void queryClient.invalidateQueries({
        queryKey: auctionKeys.detail(state.auctionId),
      });
    },
    onEvent: (eventName, payload) => {
      if (eventName === 'auction.bid.updated') {
        const bidPayload = payload as BidUpdatedPayload;
        queryClient.setQueryData<Auction>(
          auctionKeys.detail(bidPayload.auctionId),
          (current) =>
            current && {
              ...current,
              currentHighestBid: String(bidPayload.amount),
            },
        );
        void queryClient.invalidateQueries({
          queryKey: auctionKeys.bids(bidPayload.auctionId),
        });
        // A new top bid may have just taken the lead away from — or
        // handed it to — this viewer. Only the per-caller endpoint knows.
        void queryClient.invalidateQueries({
          queryKey: auctionKeys.detail(bidPayload.auctionId),
        });
      } else {
        const endedPayload = payload as AuctionEndedPayload;
        queryClient.setQueryData<Auction>(
          auctionKeys.detail(endedPayload.auctionId),
          (current) =>
            current && {
              ...current,
              status: 'ENDED',
              currentHighestBid:
                endedPayload.winningAmount ?? current.currentHighestBid,
            },
        );
        // Whether this viewer won is, again, per-caller.
        void queryClient.invalidateQueries({
          queryKey: auctionKeys.detail(endedPayload.auctionId),
        });
      }
    },
  });
}
