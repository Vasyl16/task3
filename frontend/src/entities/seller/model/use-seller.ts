import { useQuery } from '@tanstack/react-query';
import { sellerApi, sellerKeys } from '../api/seller-api';
import type { ListSellerApplicationsParams } from './seller';

export function useMySellerProfile() {
  return useQuery({
    queryKey: sellerKeys.myProfile(),
    queryFn: sellerApi.myProfile,
  });
}

export function useSellerProfile(id: string | undefined) {
  return useQuery({
    queryKey: sellerKeys.detail(id ?? ''),
    queryFn: () => sellerApi.byId(id as string),
    enabled: Boolean(id),
  });
}

export function useAdminSellerApplications(
  params?: ListSellerApplicationsParams,
) {
  return useQuery({
    queryKey: sellerKeys.adminApplications(params),
    queryFn: () => sellerApi.adminListApplications(params),
  });
}
