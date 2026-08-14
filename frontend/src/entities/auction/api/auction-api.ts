import { api } from '../../../shared/api';
import type { QueryParams } from '../../../shared/api';
import type {
  Auction,
  Bid,
  CreateAuctionInput,
  ListAuctionsParams,
} from '../model/auction';

export const auctionApi = {
  list: (params?: ListAuctionsParams) =>
    api.get<Auction[]>('/auctions', { params: params as QueryParams }),
  // Every auction the current user has placed at least one bid on — see
  // BiddingController.findMyAuctions. Identity comes from the JWT, not a
  // request param.
  mine: () => api.get<Auction[]>('/auctions/mine'),
  byId: (id: string) => api.get<Auction>(`/auctions/${id}`),
  create: (body: CreateAuctionInput) => api.post<Auction>('/auctions', body),
  bids: (auctionId: string) => api.get<Bid[]>(`/auctions/${auctionId}/bids`),
  placeBid: (auctionId: string, amount: number, idempotencyKey: string) =>
    api.post<Bid>(
      `/auctions/${auctionId}/bids`,
      { amount },
      { headers: { 'Idempotency-Key': idempotencyKey } },
    ),
};

export const auctionKeys = {
  all: ['auctions'] as const,
  lists: () => [...auctionKeys.all, 'list'] as const,
  list: (params?: ListAuctionsParams) =>
    [...auctionKeys.lists(), params ?? {}] as const,
  mine: () => [...auctionKeys.all, 'mine'] as const,
  details: () => [...auctionKeys.all, 'detail'] as const,
  detail: (id: string) => [...auctionKeys.details(), id] as const,
  bids: (id: string) => [...auctionKeys.detail(id), 'bids'] as const,
};
