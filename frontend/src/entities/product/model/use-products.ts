import { useQuery } from '@tanstack/react-query';
import { productApi, productKeys } from '../api/product-api';
import type {
  AdminListProductsParams,
  ListProductsParams,
  ProductStatus,
} from './product';

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

// A seller's own listings in every state, archived included.
export function useMyProducts(params?: { status?: ProductStatus }) {
  return useQuery({
    queryKey: productKeys.own(params),
    queryFn: () => productApi.listOwn(params),
  });
}
