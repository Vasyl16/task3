import { useQuery } from '@tanstack/react-query';
import { disputeApi, disputeKeys } from '../api/dispute-api';
import type { ListDisputesParams } from './dispute';

export function useDisputes(params?: ListDisputesParams) {
  return useQuery({
    queryKey: disputeKeys.list(params),
    queryFn: () => disputeApi.list(params),
  });
}

export function useDispute(id: string | undefined) {
  return useQuery({
    queryKey: disputeKeys.detail(id ?? ''),
    queryFn: () => disputeApi.byId(id as string),
    enabled: Boolean(id),
  });
}

export function useAdminDisputes(params?: ListDisputesParams) {
  return useQuery({
    queryKey: disputeKeys.adminList(params),
    queryFn: () => disputeApi.adminList(params),
  });
}

export function useDisputeComments(disputeId: string | undefined) {
  return useQuery({
    queryKey: disputeKeys.comments(disputeId ?? ''),
    queryFn: () => disputeApi.comments(disputeId as string),
    enabled: Boolean(disputeId),
  });
}

// SELLER only — disputes raised against the caller's own shipments.
export function useSellerDisputes(params?: ListDisputesParams) {
  return useQuery({
    queryKey: disputeKeys.sellerList(params),
    queryFn: () => disputeApi.sellerList(params),
  });
}
