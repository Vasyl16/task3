import { api } from '../../../shared/api';
import type { Notification } from '../model/notification';

export const notificationApi = {
  list: (unreadOnly?: boolean) =>
    api.get<Notification[]>('/notifications', {
      // The backend compares this literally against the string "true" —
      // not a coerced boolean — so anything else (including omitting
      // the param) is treated as "show all".
      params: unreadOnly ? { unreadOnly: 'true' } : undefined,
    }),
  markRead: (id: string) =>
    api.patch<Notification>(`/notifications/${id}/read`),
};

export const notificationKeys = {
  all: ['notifications'] as const,
  list: (unreadOnly?: boolean) =>
    [...notificationKeys.all, 'list', Boolean(unreadOnly)] as const,
};
