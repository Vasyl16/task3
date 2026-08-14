import { api } from '../../../shared/api';
import type { Paginated, QueryParams } from '../../../shared/api';
import type {
  AdminListProductsParams,
  CreateProductInput,
  ListProductsParams,
  ModerateProductInput,
  ListOwnProductsParams,
  Product,
  UpdateProductInput,
} from '../model/product';

export const productApi = {
  list: (params?: ListProductsParams) =>
    api.get<Product[]>('/products', { params: params as QueryParams }),
  byId: (id: string) => api.get<Product>(`/products/${id}`),
  // The seller's OWN catalogue, including ARCHIVED — the public list
  // hides those, which left a seller unable to find one to restore.
  listOwn: (params?: ListOwnProductsParams) =>
    api.get<Paginated<Product>>('/products/mine', {
      params: params as QueryParams,
    }),
  restore: (id: string) => api.post<Product>(`/products/${id}/restore`),
  create: (body: CreateProductInput) => api.post<Product>('/products', body),
  update: (id: string, body: UpdateProductInput) =>
    api.patch<Product>(`/products/${id}`, body),
  // Soft-delete: sets status ARCHIVED, still returns the product (200).
  archive: (id: string) => api.delete<Product>(`/products/${id}`),
  // multipart/form-data — the shared client passes a FormData body
  // through untouched (no JSON.stringify, no Content-Type override) so
  // fetch can set its own multipart boundary. See http-client.ts.
  uploadImage: (id: string, file: File) => {
    const formData = new FormData();
    formData.append('image', file);
    return api.post<Product>(`/products/${id}/image`, formData);
  },
  // ADMIN only — includes ARCHIVED products, which the public list omits.
  adminList: (params?: AdminListProductsParams) =>
    api.get<Paginated<Product>>('/admin/products', {
      params: params as QueryParams,
    }),
  adminModerate: (id: string, body: ModerateProductInput) =>
    api.patch<Product>(`/admin/products/${id}/moderation`, body),
};

export const productKeys = {
  all: ['products'] as const,
  lists: () => [...productKeys.all, 'list'] as const,
  list: (params?: ListProductsParams) =>
    [...productKeys.lists(), params ?? {}] as const,
  details: () => [...productKeys.all, 'detail'] as const,
  detail: (id: string) => [...productKeys.details(), id] as const,
  own: (params?: ListOwnProductsParams) =>
    [...productKeys.all, 'own', params ?? {}] as const,
  adminLists: () => [...productKeys.all, 'admin-list'] as const,
  adminList: (params?: AdminListProductsParams) =>
    [...productKeys.adminLists(), params ?? {}] as const,
};
