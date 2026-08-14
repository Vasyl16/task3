import { api } from '../../../shared/api';
import type { QueryParams } from '../../../shared/api';
import type {
  ApplySellerInput,
  ListSellerApplicationsParams,
  ReviewSellerInput,
  SellerProfile,
} from '../model/seller';

export const sellerApi = {
  byId: (id: string) => api.get<SellerProfile>(`/sellers/${id}`),
  myProfile: () => api.get<SellerProfile | null>('/sellers/me/profile'),
  apply: (body: ApplySellerInput) =>
    api.post<SellerProfile>('/sellers/apply', body),
  // ADMIN only.
  adminListApplications: (params?: ListSellerApplicationsParams) =>
    api.get<SellerProfile[]>('/admin/seller-applications', {
      params: params as QueryParams,
    }),
  adminReview: (id: string, body: ReviewSellerInput) =>
    api.patch<SellerProfile>(`/admin/seller-applications/${id}`, body),
};

export const sellerKeys = {
  all: ['sellers'] as const,
  detail: (id: string) => [...sellerKeys.all, 'detail', id] as const,
  myProfile: () => [...sellerKeys.all, 'me'] as const,
  adminApplications: (params?: ListSellerApplicationsParams) =>
    [...sellerKeys.all, 'admin-applications', params ?? {}] as const,
};
