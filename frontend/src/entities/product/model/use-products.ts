import { useQuery } from '@tanstack/react-query';
import { productApi, productKeys } from '../api/product-api';
import type { AdminListProductsParams, ListProductsParams } from './product';

export function useProducts(params?: ListProductsParams) {
  return useQuery({
    queryKey: productKeys.list(params),
    queryFn: () => productApi.list(params),
  });
}

export function useProduct(id: string | undefined) {
  return useQuery({
    queryKey: productKeys.detail(id ?? ''),
    queryFn: () => productApi.byId(id as string),
    enabled: Boolean(id),
  });
}

export function useAdminProducts(params?: AdminListProductsParams) {
  return useQuery({
    queryKey: productKeys.adminList(params),
    queryFn: () => productApi.adminList(params),
  });
}
