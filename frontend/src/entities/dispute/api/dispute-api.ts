import { api } from '../../../shared/api';
import type { QueryParams } from '../../../shared/api';
import type {
  CreateDisputeInput,
  Dispute,
  ListDisputesParams,
  ResolveDisputeInput,
} from '../model/dispute';

export const disputeApi = {
  // Scoped server-side to the caller — a customer only ever sees their
  // own disputes here, regardless of params.
  list: (params?: ListDisputesParams) =>
    api.get<Dispute[]>('/disputes', { params: params as QueryParams }),
  byId: (id: string) => api.get<Dispute>(`/disputes/${id}`),
  create: (body: CreateDisputeInput) => api.post<Dispute>('/disputes', body),
  // ADMIN only — every dispute, not just the caller's own.
  adminList: (params?: ListDisputesParams) =>
    api.get<Dispute[]>('/admin/disputes', { params: params as QueryParams }),
  adminResolve: (id: string, body: ResolveDisputeInput) =>
    api.patch<Dispute>(`/admin/disputes/${id}`, body),
};

export const disputeKeys = {
  all: ['disputes'] as const,
  list: (params?: ListDisputesParams) =>
    [...disputeKeys.all, 'list', params ?? {}] as const,
  detail: (id: string) => [...disputeKeys.all, 'detail', id] as const,
  adminLists: () => [...disputeKeys.all, 'admin-list'] as const,
  adminList: (params?: ListDisputesParams) =>
    [...disputeKeys.adminLists(), params ?? {}] as const,
};
