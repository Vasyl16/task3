import { api } from '../../../shared/api';
import type { QueryParams } from '../../../shared/api';
import type {
  AddDisputeCommentInput,
  CreateDisputeInput,
  Dispute,
  DisputeComment,
  DisputeWithOrder,
  ListDisputesParams,
  ResolveDisputeInput,
} from '../model/dispute';

export const disputeApi = {
  // Scoped server-side to the caller — a customer only ever sees their
  // own disputes here, regardless of params.
  list: (params?: ListDisputesParams) =>
    api.get<Dispute[]>('/disputes', { params: params as QueryParams }),
  byId: (id: string) => api.get<DisputeWithOrder>(`/disputes/${id}`),
  create: (body: CreateDisputeInput) => api.post<Dispute>('/disputes', body),
  // One shared thread endpoint for both sides — the backend decides who
  // may read or post (the raiser, or any admin), so there is no separate
  // admin route to keep in step.
  comments: (id: string) =>
    api.get<DisputeComment[]>(`/disputes/${id}/comments`),
  addComment: (id: string, body: AddDisputeCommentInput) =>
    api.post<DisputeComment>(`/disputes/${id}/comments`, body),
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
  comments: (id: string) => [...disputeKeys.all, 'comments', id] as const,
  adminLists: () => [...disputeKeys.all, 'admin-list'] as const,
  adminList: (params?: ListDisputesParams) =>
    [...disputeKeys.adminLists(), params ?? {}] as const,
};
