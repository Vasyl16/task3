import type { AdminListOrdersParams } from './order';
import { useQuery } from '@tanstack/react-query';
import { orderApi, orderKeys } from '../api/order-api';

export function useOrders() {
  return useQuery({
    queryKey: orderKeys.lists(),
    queryFn: orderApi.list,
  });
}

export function useOrder(id: string | undefined) {
  return useQuery({
    queryKey: orderKeys.detail(id ?? ''),
    queryFn: () => orderApi.byId(id as string),
    enabled: Boolean(id),
  });
}

export function useMySellerOrders() {
  return useQuery({
    queryKey: orderKeys.mySellerOrders(),
    queryFn: orderApi.mySellerOrders,
  });
}

// ADMIN only — every order, for the moderation queue.
export function useAdminOrders(params?: AdminListOrdersParams) {
  return useQuery({
    queryKey: orderKeys.adminList(params),
    queryFn: () => orderApi.adminList(params),
  });
}
