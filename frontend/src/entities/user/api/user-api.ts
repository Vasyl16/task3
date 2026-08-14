import { api } from '../../../shared/api';
import type { PublicUser, UpdateUserInput } from '../model/user';

export const userApi = {
  byId: (id: string) => api.get<PublicUser>(`/users/${id}`),
  update: (id: string, body: UpdateUserInput) =>
    api.patch<PublicUser>(`/users/${id}`, body),
};

export const userKeys = {
  all: ['users'] as const,
  detail: (id: string) => [...userKeys.all, 'detail', id] as const,
};
