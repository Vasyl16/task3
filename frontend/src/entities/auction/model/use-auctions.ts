import { useQuery } from '@tanstack/react-query';
import { auctionApi, auctionKeys } from '../api/auction-api';
import type { ListAuctionsParams } from './auction';

export function useAuctions(params?: ListAuctionsParams) {
  return useQuery({
    queryKey: auctionKeys.list(params),
    queryFn: () => auctionApi.list(params),
  });
}

export function useMyAuctions() {
  return useQuery({
    queryKey: auctionKeys.mine(),
    queryFn: () => auctionApi.mine(),
    staleTime: 5_000,
  });
}

export function useAuction(id: string | undefined) {
  return useQuery({
    queryKey: auctionKeys.detail(id ?? ''),
    queryFn: () => auctionApi.byId(id as string),
    enabled: Boolean(id),
    // Auctions move fast near their end — a shorter staleTime than the
    // client default keeps a re-opened tab from showing a stale price
    // for long before the realtime patch (see use-auction-realtime) or a
    // background refetch corrects it.
    staleTime: 5_000,
  });
}

export function useAuctionBids(auctionId: string | undefined) {
  return useQuery({
    queryKey: auctionKeys.bids(auctionId ?? ''),
    queryFn: () => auctionApi.bids(auctionId as string),
    enabled: Boolean(auctionId),
    staleTime: 5_000,
  });
}
